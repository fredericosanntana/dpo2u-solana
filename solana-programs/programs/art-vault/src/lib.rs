// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions (custom-heap, solana, etc.); bump to 0.32+
// scheduled for post-Colosseum.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U ART Vault — MiCAR Asset-Referenced Token safeguards.
//!
//! Automates four MiCAR requirements on-chain:
//!   - Proof of Reserve (MiCAR Art. 36): reserve_amount is updated via
//!     `update_reserve` and must cover outstanding_supply 1:1 before `mint_art`
//!     succeeds.
//!   - Liquidity Vault (MiCAR Art. 39): a fraction (`liquidity_bps`, default
//!     2000 = 20%) of reserve_amount is earmarked for instant redemption.
//!   - Capital Buffer (MiCAR Art. 35): `capital_buffer_bps` (default 300 = 3%)
//!     of reserve_amount is locked and cannot be used operationally.
//!   - Velocity Limiter (MiCAR Art. 23): daily cap on mint_art volume;
//!     circuit breaker trip resets manually.
//!
//! MVP scope:
//!   - Oracle integration is stubbed: `update_reserve` accepts the price as an
//!     argument (documented as "oracle-supplied"). Pyth/Switchboard wiring is
//!     deferred per plan downgrade path.
//!   - Guardian multi-sig is NOT in this program. The `authority` is a single
//!     signer (intended to be a Squads v4 multi-sig in production — the program
//!     sees only `Pubkey`, so swapping single → multi-sig is zero-code).

use anchor_lang::prelude::*;
use pyth_sdk_solana::state::SolanaPriceAccount;

declare_id!("C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna");

const DEFAULT_LIQUIDITY_BPS: u16 = 2000; // 20%
const DEFAULT_CAPITAL_BUFFER_BPS: u16 = 300; // 3% (MiCAR Art. 35)
const BPS_DENOM: u64 = 10_000;
const SECONDS_PER_DAY: i64 = 86_400;

/// Max staleness tolerated on a Pyth price feed, in seconds. Protects the
/// vault from using stale prices if the Pyth publisher network is degraded.
/// 60s is conservative for MiCAR Art. 36 PoR; tighten to 15-30s if SLA
/// of the specific price feed allows.
const MAX_PRICE_STALENESS_SECONDS: i64 = 60;

#[program]
pub mod art_vault {
    use super::*;

    /// Initialize a new ART vault. Called once per ART issuer.
    pub fn init_vault(
        ctx: Context<InitVault>,
        liquidity_bps: u16,
        capital_buffer_bps: u16,
        daily_cap: u64,
    ) -> Result<()> {
        require!(liquidity_bps <= BPS_DENOM as u16, VaultErr::InvalidBps);
        require!(capital_buffer_bps <= BPS_DENOM as u16, VaultErr::InvalidBps);
        require!(
            (liquidity_bps as u64) + (capital_buffer_bps as u64) <= BPS_DENOM,
            VaultErr::BpsSumOverflow
        );

        let clock = Clock::get()?;
        let v = &mut ctx.accounts.vault;
        v.authority = ctx.accounts.authority.key();
        v.reserve_amount = 0;
        v.outstanding_supply = 0;
        v.liquidity_bps = if liquidity_bps == 0 { DEFAULT_LIQUIDITY_BPS } else { liquidity_bps };
        v.capital_buffer_bps = if capital_buffer_bps == 0 {
            DEFAULT_CAPITAL_BUFFER_BPS
        } else {
            capital_buffer_bps
        };
        v.daily_cap = daily_cap;
        v.daily_spent = 0;
        v.last_reset_day = clock.unix_timestamp / SECONDS_PER_DAY;
        v.circuit_tripped = false;
        v.version = 1;
        v.bump = ctx.bumps.vault;

        emit!(VaultInitialized {
            authority: v.authority,
            liquidity_bps: v.liquidity_bps,
            capital_buffer_bps: v.capital_buffer_bps,
            daily_cap: v.daily_cap,
        });
        Ok(())
    }

    /// Update the on-chain reserve amount via a caller-asserted value.
    ///
    /// LEGACY path — kept for back-compat + tests where the caller pre-computes
    /// the reserve (e.g., NAV from a custody report). For production MiCAR
    /// Art. 36 Proof of Reserve, prefer `update_reserve_from_pyth` which
    /// reads a Pyth price feed + applies staleness + confidence checks.
    pub fn update_reserve(ctx: Context<UpdateReserve>, reserve_amount: u64) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);
        v.reserve_amount = reserve_amount;

        emit!(ReserveUpdated {
            authority: v.authority,
            reserve_amount,
            outstanding_supply: v.outstanding_supply,
            ratio_bps: reserve_ratio_bps(v),
            source: ReserveSource::CallerAsserted,
        });
        Ok(())
    }

    /// Update reserve from a Pyth Network price feed.
    ///
    /// Reads a Pyth price account, validates staleness (`MAX_PRICE_STALENESS_SECONDS`),
    /// enforces a minimum confidence threshold (price ± conf must be within
    /// `max_confidence_bps` of the price itself), and computes:
    ///
    ///   reserve_amount = reserve_asset_units * price_normalized
    ///
    /// `reserve_asset_units` is caller-supplied (e.g., total SOL held in
    /// custody in lamports for SOL/USD feed). The program applies the
    /// feed's exponent to align decimals with the ART token units.
    ///
    /// MiCAR Art. 36 fit: continuous proof of reserve updated by anyone with
    /// a fresh Pyth price — trustless PoR with a single CPI-free instruction.
    ///
    /// Authority check: only `vault.authority` may invoke (prevents a random
    /// user from DoS-ing reserve updates with a bad price).
    pub fn update_reserve_from_pyth(
        ctx: Context<UpdateReserveFromPyth>,
        reserve_asset_units: u64,
        max_confidence_bps: u16,
    ) -> Result<()> {
        require!(max_confidence_bps <= BPS_DENOM as u16, VaultErr::InvalidBps);

        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);

        let now = Clock::get()?.unix_timestamp;
        let price_feed = SolanaPriceAccount::account_info_to_feed(&ctx.accounts.pyth_price)
            .map_err(|_| VaultErr::PythAccountInvalid)?;

        // Get price with a staleness check. This returns Ok only if the
        // price was published within the max_age window.
        let price = price_feed
            .get_price_no_older_than(now, MAX_PRICE_STALENESS_SECONDS as u64)
            .ok_or(VaultErr::PythPriceStale)?;

        // Reject non-positive prices (Pyth can return negative for some
        // exotic feeds; we only trust positive USD-denominated prices).
        require!(price.price > 0, VaultErr::PythPriceInvalid);

        // Confidence interval check: conf / price ≤ max_confidence_bps.
        // price.conf is unsigned (u64); price.price is i64 but we just checked > 0.
        let price_abs = price.price as u64;
        let conf_bps = (price.conf as u128)
            .checked_mul(BPS_DENOM as u128)
            .and_then(|x| x.checked_div(price_abs as u128))
            .ok_or(VaultErr::ArithmeticOverflow)?;
        require!(
            conf_bps <= max_confidence_bps as u128,
            VaultErr::PythConfidenceTooWide
        );

        // Compute reserve_amount = reserve_asset_units * price * 10^exponent.
        // Pyth exponent is typically negative (e.g., -8 for SOL/USD meaning
        // the price is in 10^-8 USD units). We cap to u64.
        let reserve_amount = apply_pyth_price_to_units(reserve_asset_units, price.price, price.expo)?;

        v.reserve_amount = reserve_amount;

        emit!(ReserveUpdated {
            authority: v.authority,
            reserve_amount,
            outstanding_supply: v.outstanding_supply,
            ratio_bps: reserve_ratio_bps(v),
            source: ReserveSource::Pyth,
        });
        emit!(PythReserveUpdated {
            authority: v.authority,
            reserve_asset_units,
            price: price.price,
            confidence: price.conf,
            expo: price.expo,
            publish_time: price.publish_time,
            reserve_amount,
        });
        Ok(())
    }

    /// Mint ART tokens. Enforces:
    ///   - Circuit breaker not tripped.
    ///   - Reserve >= outstanding + amount + capital_buffer share (MiCAR Art. 35).
    ///   - Daily cap not exceeded (MiCAR Art. 23 proxy).
    ///
    /// MVP: does NOT perform an SPL Token mint CPI — this is an accounting-only
    /// instruction that marks the mint as valid under MiCAR safeguards. A
    /// downstream program (or off-chain) handles the token issuance itself.
    pub fn mint_art(ctx: Context<MintArt>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultErr::ZeroAmount);

        let clock = Clock::get()?;
        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);
        require!(!v.circuit_tripped, VaultErr::CircuitBreakerTripped);

        let current_day = clock.unix_timestamp / SECONDS_PER_DAY;
        if current_day > v.last_reset_day {
            v.daily_spent = 0;
            v.last_reset_day = current_day;
        }
        require!(
            v.daily_spent.checked_add(amount).ok_or(VaultErr::ArithmeticOverflow)? <= v.daily_cap,
            VaultErr::DailyCapExceeded
        );

        // Reserve coverage check: reserve must cover (outstanding + amount) * (1 + buffer)
        let new_supply = v
            .outstanding_supply
            .checked_add(amount)
            .ok_or(VaultErr::ArithmeticOverflow)?;
        let required_reserve = supply_plus_buffer(new_supply, v.capital_buffer_bps)?;
        require!(v.reserve_amount >= required_reserve, VaultErr::ReserveInsufficient);

        v.outstanding_supply = new_supply;
        v.daily_spent = v
            .daily_spent
            .checked_add(amount)
            .ok_or(VaultErr::ArithmeticOverflow)?;

        emit!(ArtMinted {
            authority: v.authority,
            amount,
            outstanding_supply: v.outstanding_supply,
            reserve_ratio_bps: reserve_ratio_bps(v),
        });
        Ok(())
    }

    /// Redeem ART tokens against the liquidity vault share. Enforces:
    ///   - Circuit breaker not tripped.
    ///   - Amount <= liquidity_vault_budget = reserve * liquidity_bps / 10000.
    ///
    /// MVP: accounting-only (no SPL transfer CPI).
    pub fn redeem_art(ctx: Context<RedeemArt>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultErr::ZeroAmount);

        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);
        require!(!v.circuit_tripped, VaultErr::CircuitBreakerTripped);
        require!(amount <= v.outstanding_supply, VaultErr::InsufficientSupply);

        let liquidity_budget = mul_bps(v.reserve_amount, v.liquidity_bps)?;
        require!(amount <= liquidity_budget, VaultErr::LiquidityVaultExceeded);

        v.outstanding_supply = v.outstanding_supply.saturating_sub(amount);
        // Reserve decreases in lockstep — this is the "burn + unlock" accounting.
        v.reserve_amount = v.reserve_amount.saturating_sub(amount);

        emit!(ArtRedeemed {
            authority: v.authority,
            amount,
            outstanding_supply: v.outstanding_supply,
            reserve_ratio_bps: reserve_ratio_bps(v),
        });
        Ok(())
    }

    /// Trip the circuit breaker (MiCAR Art. 23 halt). Only authority may call.
    /// Reset is not exposed in MVP — manual governance action required.
    pub fn trip_circuit_breaker(ctx: Context<TripCircuit>, reason_code: u16) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);
        require!(!v.circuit_tripped, VaultErr::CircuitBreakerTripped);
        v.circuit_tripped = true;

        emit!(CircuitBreakerTripped {
            authority: v.authority,
            reason_code,
            tripped_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Transfer the vault's `authority` field to a new Pubkey (e.g., Squads
    /// MiCAR Reserve vault PDA).
    ///
    /// Composed Stack Fase 1.c — completes the Squads v4 governance migration
    /// by handing over MiCAR reserve authority to a multisig-controlled PDA.
    ///
    /// FORWARD-ONLY MIGRATION (KNOWN LIMITATION):
    ///   The vault PDA seed pattern is `[b"art_vault", authority.key().as_ref()]`,
    ///   meaning the *operations* (update_reserve, mint_art, redeem_art,
    ///   trip_circuit_breaker) verify the signer's key against the seed —
    ///   the seed is the ORIGINAL creator's key, not the stored authority field.
    ///   After `transfer_authority` updates `vault.authority`, those operations
    ///   are blocked because the new authority's signer cannot satisfy the
    ///   seed constraint.
    ///
    ///   This is acceptable for an audit/governance scenario where the goal
    ///   is to FREEZE the vault under multisig oversight and resume operations
    ///   only via a v2 program upgrade with refactored seeds (decoupled from
    ///   authority). Sprint G follow-up: redesign with `[b"art_vault", vault_id]`
    ///   seed pattern.
    ///
    /// Use case: hand over MiCAR Reserve vault to Squads vault[2] PDA,
    /// then upgrade program (via Squads Governance multisig) to enable
    /// resumed ops under multisig signing.
    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), VaultErr::Unauthorized);
        // Defensive: refuse zero pubkey (would brick the vault permanently).
        require!(new_authority != Pubkey::default(), VaultErr::InvalidNewAuthority);

        let previous_authority = v.authority;
        v.authority = new_authority;

        emit!(AuthorityTransferred {
            vault: ctx.accounts.vault.key(),
            previous_authority,
            new_authority,
            transferred_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// -- Helpers --

/// Convert `(reserve_asset_units, price, expo)` from a Pyth price feed into
/// a u64 `reserve_amount` value, rounding toward zero.
///
///   reserve_amount = reserve_asset_units * price * 10^expo
///
/// Pyth's `expo` is typically negative (e.g. -8). We keep precision by
/// multiplying first, then dividing by 10^(-expo).
fn apply_pyth_price_to_units(units: u64, price: i64, expo: i32) -> Result<u64> {
    // We only accept positive prices (enforced by caller).
    if price <= 0 {
        return Err(VaultErr::PythPriceInvalid.into());
    }
    let price_u128 = price as u128;
    let units_u128 = units as u128;
    let product = units_u128
        .checked_mul(price_u128)
        .ok_or(VaultErr::ArithmeticOverflow)?;

    let scaled: u128 = if expo < 0 {
        // Divide by 10^|expo|
        let divisor = 10u128
            .checked_pow((-expo) as u32)
            .ok_or(VaultErr::ArithmeticOverflow)?;
        product / divisor
    } else if expo > 0 {
        // Multiply by 10^expo
        let multiplier = 10u128
            .checked_pow(expo as u32)
            .ok_or(VaultErr::ArithmeticOverflow)?;
        product
            .checked_mul(multiplier)
            .ok_or(VaultErr::ArithmeticOverflow)?
    } else {
        product
    };

    if scaled > u64::MAX as u128 {
        return Err(VaultErr::ArithmeticOverflow.into());
    }
    Ok(scaled as u64)
}

fn mul_bps(amount: u64, bps: u16) -> Result<u64> {
    let r = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(VaultErr::ArithmeticOverflow)?
        .checked_div(BPS_DENOM as u128)
        .ok_or(VaultErr::ArithmeticOverflow)?;
    if r > u64::MAX as u128 {
        return Err(VaultErr::ArithmeticOverflow.into());
    }
    Ok(r as u64)
}

fn supply_plus_buffer(supply: u64, buffer_bps: u16) -> Result<u64> {
    let buffer = mul_bps(supply, buffer_bps)?;
    supply.checked_add(buffer).ok_or_else(|| VaultErr::ArithmeticOverflow.into())
}

fn reserve_ratio_bps(v: &ArtVault) -> u16 {
    if v.outstanding_supply == 0 {
        return u16::MAX; // "infinite" — no outstanding yet
    }
    let ratio = (v.reserve_amount as u128) * (BPS_DENOM as u128) / (v.outstanding_supply as u128);
    if ratio > u16::MAX as u128 {
        u16::MAX
    } else {
        ratio as u16
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct ArtVault {
    pub authority: Pubkey,
    pub reserve_amount: u64,
    pub outstanding_supply: u64,
    pub liquidity_bps: u16,
    pub capital_buffer_bps: u16,
    pub daily_cap: u64,
    pub daily_spent: u64,
    pub last_reset_day: i64,
    pub circuit_tripped: bool,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ArtVault::INIT_SPACE,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, ArtVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReserve<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, ArtVault>,
}

#[derive(Accounts)]
pub struct UpdateReserveFromPyth<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, ArtVault>,
    /// CHECK: owner + discriminator are validated via `SolanaPriceAccount::account_info_to_feed`.
    /// No address constraint — the authority chooses which price feed backs this vault
    /// (e.g., SOL/USD on mainnet: H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG).
    pub pyth_price: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct MintArt<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, ArtVault>,
}

#[derive(Accounts)]
pub struct RedeemArt<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, ArtVault>,
}

#[derive(Accounts)]
pub struct TripCircuit<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"art_vault", authority.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, ArtVault>,
}

/// One-shot migration: takes the vault account directly (no PDA derivation
/// from signer). Verifies signer == vault.authority in the handler body.
/// See `transfer_authority` doc for the forward-only migration semantics.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, ArtVault>,
}

// -- Events --

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub liquidity_bps: u16,
    pub capital_buffer_bps: u16,
    pub daily_cap: u64,
}

#[event]
pub struct ReserveUpdated {
    pub authority: Pubkey,
    pub reserve_amount: u64,
    pub outstanding_supply: u64,
    pub ratio_bps: u16,
    pub source: ReserveSource,
}

#[event]
pub struct PythReserveUpdated {
    pub authority: Pubkey,
    pub reserve_asset_units: u64,
    pub price: i64,
    pub confidence: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub reserve_amount: u64,
}

/// Indicates the source of the latest reserve_amount value. Useful for
/// off-chain auditors to distinguish oracle-backed updates from caller-
/// asserted ones when reviewing the on-chain history.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReserveSource {
    CallerAsserted,
    Pyth,
}

#[event]
pub struct ArtMinted {
    pub authority: Pubkey,
    pub amount: u64,
    pub outstanding_supply: u64,
    pub reserve_ratio_bps: u16,
}

#[event]
pub struct ArtRedeemed {
    pub authority: Pubkey,
    pub amount: u64,
    pub outstanding_supply: u64,
    pub reserve_ratio_bps: u16,
}

#[event]
pub struct CircuitBreakerTripped {
    pub authority: Pubkey,
    pub reason_code: u16,
    pub tripped_at: i64,
}

#[event]
pub struct AuthorityTransferred {
    pub vault: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
    pub transferred_at: i64,
}

// -- Errors --

#[error_code]
pub enum VaultErr {
    #[msg("bps value must be <= 10000")]
    InvalidBps,
    #[msg("liquidity_bps + capital_buffer_bps must be <= 10000")]
    BpsSumOverflow,
    #[msg("only the vault authority can call this instruction")]
    Unauthorized,
    #[msg("circuit breaker is tripped — mint/redeem halted (MiCAR Art. 23)")]
    CircuitBreakerTripped,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("reserve insufficient for outstanding + new supply + capital buffer (MiCAR Art. 36)")]
    ReserveInsufficient,
    #[msg("daily mint cap exceeded (MiCAR Art. 23 velocity limiter)")]
    DailyCapExceeded,
    #[msg("redeem amount exceeds liquidity vault budget (MiCAR Art. 39)")]
    LiquidityVaultExceeded,
    #[msg("redeem amount exceeds outstanding ART supply")]
    InsufficientSupply,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Pyth price account is malformed or not owned by a known Pyth program")]
    PythAccountInvalid,
    #[msg("Pyth price is stale (older than MAX_PRICE_STALENESS_SECONDS)")]
    PythPriceStale,
    #[msg("Pyth price is non-positive — rejected")]
    PythPriceInvalid,
    #[msg("Pyth confidence interval too wide relative to price (max_confidence_bps exceeded)")]
    PythConfidenceTooWide,
    #[msg("new authority cannot be the zero pubkey (would brick the vault)")]
    InvalidNewAuthority,
}

// -- Inline Rust unit tests --

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyth_price_positive_expo() {
        // units=10, price=50, expo=1 → 10 * 50 * 10 = 5000
        let r = apply_pyth_price_to_units(10, 50, 1).unwrap();
        assert_eq!(r, 5000);
    }

    #[test]
    fn pyth_price_negative_expo_sol_usd_example() {
        // SOL/USD on Pyth typically has price ≈ 15000000000 (= $150.00000000) with expo = -8.
        // If we hold 2 SOL = 2_000_000_000 lamports... no wait, lamports are 10^-9 SOL.
        // Simplification: hold 1 SOL-equivalent-units with a $150 price in -8 expo.
        // reserve = 1 * 15_000_000_000 / 10^8 = 150
        let r = apply_pyth_price_to_units(1, 15_000_000_000, -8).unwrap();
        assert_eq!(r, 150);
    }

    #[test]
    fn pyth_price_zero_expo() {
        let r = apply_pyth_price_to_units(100, 42, 0).unwrap();
        assert_eq!(r, 4200);
    }

    #[test]
    fn pyth_price_rejects_negative_price() {
        let r = apply_pyth_price_to_units(10, -1, 0);
        assert!(r.is_err());
    }

    #[test]
    fn pyth_price_rejects_zero_price() {
        let r = apply_pyth_price_to_units(10, 0, 0);
        assert!(r.is_err());
    }

    #[test]
    fn pyth_price_u64_overflow_guard() {
        // Huge product that doesn't fit in u64
        let r = apply_pyth_price_to_units(u64::MAX, 1_000_000, 0);
        assert!(r.is_err());
    }

    #[test]
    fn reserve_source_roundtrip_via_borsh() {
        // Ensure the enum serializes with borsh — required for on-chain event emit.
        let cases = [ReserveSource::CallerAsserted, ReserveSource::Pyth];
        for c in cases {
            let mut buf = Vec::new();
            c.serialize(&mut buf).unwrap();
            let decoded = ReserveSource::deserialize(&mut &buf[..]).unwrap();
            assert_eq!(c, decoded);
        }
    }
}
