// Kolibri KBR — Kolibri Bitcoin Reserve (Pinocchio)
// ==================================================
//
// Implements the sovereign-redemption mechanism from the KNECT White Paper v2.1
// §05. The KBR is a cbBTC reserve vault that defines a per-token floor:
//
//   KBR Ratio = btc_in_vault / knect_supply
//
// Redemption is proportional and contract-executed (not company-executed):
//   gross  = knect_amount * btc_in_vault / knect_supply
//   fee    = gross * fee_bps / 10_000          (stays in the vault)
//   net    = gross - fee                        (paid to the holder, cbBTC out)
//   burn knect_amount  ⇒  knect_supply decreases
//
// Effect: the floor of the REMAINING holders can only rise — redeeming 1% of
// supply pays out ~0.99% of the BTC and burns 1% of the tokens, so the ratio of
// the remainder ticks up by the retained fee. A bank-run is mathematically
// disincentivized (the incentive of the panic is inverted by arithmetic).
//
// Selectors:
//   0x00 initialize_kbr   — admin sets cbBTC mint + KNECT mint + vault + fee_bps + supply
//   0x01 deposit_reserve  — DCA orchestrator deposits cbBTC into the vault
//   0x02 redeem           — holder burns KNECT, receives cbBTC at the KBR ratio
//
// Design choices:
//   - Pinocchio (not Anchor) for low CU on the hot path
//   - cbBTC vault ATA is owned by the config PDA; redeem transfers out via
//     invoke_signed with the config seeds (the contract, not the company, pays)
//   - KNECT burn is signed by the holder (their own token account)
//   - DCA into cbBTC (Jupiter) and the headline floor (BTC ÷ 1B total supply)
//     are OFF-CHAIN/derived; this program only does deposit + sovereign redeem
//   - SPL Token v1 only; Token-2022 (confidential transfers) is a gated upgrade
//
// Program ID: 2KjMGtciVcoWVJ6qUjkwupixUWW8kyvRNSpDdgAWeXd9 (devnet, rotates pre-mainnet)

#![allow(dead_code, unused_imports, unexpected_cfgs)]

extern crate alloc;

use alloc::vec::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    entrypoint,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

pinocchio_pubkey::declare_id!("2KjMGtciVcoWVJ6qUjkwupixUWW8kyvRNSpDdgAWeXd9");

const CONFIG_SEED: &[u8] = b"kbr_config";

/// SPL Token program ID (legacy). Token-2022 support is a gated upgrade.
const SPL_TOKEN_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// First 8 bytes of sha256("account:KbrConfig").
const KBR_CONFIG_DISCRIMINATOR: [u8; 8] = [0x41, 0x0a, 0xde, 0x41, 0xce, 0xe1, 0x2f, 0x36];

const TOTAL_BPS: u16 = 10_000;
/// Redemption fee cap — defensive bound (10% max); the WP value is 1% (100 bps).
const MAX_FEE_BPS: u16 = 1_000;

mod err {
    pub const NOT_ADMIN: u32 = 0x5001;
    pub const WRONG_PDA: u32 = 0x5002;
    pub const WRONG_TOKEN_PROGRAM: u32 = 0x5003;
    pub const VAULT_MISMATCH: u32 = 0x5004;
    pub const MINT_MISMATCH: u32 = 0x5005;
    pub const AMOUNT_ZERO: u32 = 0x5006;
    pub const ARITHMETIC_OVERFLOW: u32 = 0x5007;
    pub const ALREADY_INITIALIZED: u32 = 0x5008;
    pub const NOT_INITIALIZED: u32 = 0x5009;
    pub const SIGNER_REQUIRED: u32 = 0x500A;
    pub const FEE_TOO_HIGH: u32 = 0x500B;
    pub const SUPPLY_EXCEEDED: u32 = 0x500C;
    pub const RESERVE_EMPTY: u32 = 0x500D;
}

// =============================================================================
// State
// =============================================================================

/// Stored at PDA seeded by [b"kbr_config", admin_pubkey].
#[derive(BorshSerialize, BorshDeserialize)]
struct KbrConfig {
    admin: [u8; 32],
    cbbtc_mint: [u8; 32],
    knect_mint: [u8; 32],
    /// cbBTC vault token account — authority MUST be this config PDA.
    vault_cbbtc: [u8; 32],

    fee_bps: u16,
    /// Redemption denominator — decremented as KNECT is burned on redeem.
    knect_supply: u64,
    /// Mirror of the vault cbBTC balance (telemetry; authoritative balance is the ATA).
    btc_in_vault: u64,

    total_redeemed_knect: u64,
    total_fee_btc: u64,
    redemptions_count: u32,

    bump: u8,
    schema_version: u8,
}

// Borsh size: 32*4 + 2 + 8 + 8 + 8 + 8 + 4 + 1 + 1 = 168
const CONFIG_MAX_DATA: usize = 168;
const CONFIG_ACCOUNT_SPACE: usize = 8 + CONFIG_MAX_DATA;

// =============================================================================
// Instruction args
// =============================================================================

#[derive(BorshDeserialize)]
struct InitializeKbrArgs {
    cbbtc_mint: [u8; 32],
    knect_mint: [u8; 32],
    vault_cbbtc: [u8; 32],
    fee_bps: u16,
    knect_supply: u64,
}

#[derive(BorshDeserialize)]
struct DepositReserveArgs {
    amount: u64,
}

#[derive(BorshDeserialize)]
struct RedeemArgs {
    knect_amount: u64,
}

// =============================================================================
// Entrypoint
// =============================================================================

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (selector, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *selector {
        0x00 => initialize_kbr(program_id, accounts, rest),
        0x01 => deposit_reserve(program_id, accounts, rest),
        0x02 => redeem(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// =============================================================================
// 0x00 initialize_kbr
// =============================================================================
//
// Accounts:
//   [0] admin          (signer, writable, fee payer)
//   [1] config_pda     (writable, PDA seed [b"kbr_config", admin])
//   [2] system_program
//   [3] rent_sysvar

fn initialize_kbr(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let args = InitializeKbrArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.fee_bps > MAX_FEE_BPS {
        return Err(ProgramError::Custom(err::FEE_TOO_HIGH));
    }
    if args.knect_supply == 0 {
        return Err(ProgramError::Custom(err::AMOUNT_ZERO));
    }

    let [admin, config_pda, system_program, rent_sysvar] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }
    if system_program.key() != &[0u8; 32] {
        return Err(ProgramError::IncorrectProgramId);
    }
    if config_pda.lamports() > 0 {
        return Err(ProgramError::Custom(err::ALREADY_INITIALIZED));
    }

    let (expected_pda, bump) = find_program_address(&[CONFIG_SEED, admin.key()], program_id);
    if config_pda.key() != &expected_pda {
        return Err(ProgramError::Custom(err::WRONG_PDA));
    }

    let rent_ref = Rent::from_account_info(rent_sysvar)?;
    let lamports = rent_ref.minimum_balance(CONFIG_ACCOUNT_SPACE);
    drop(rent_ref);

    let bump_seed = [bump];
    let seeds: [Seed; 3] = [
        Seed::from(CONFIG_SEED),
        Seed::from(admin.key().as_slice()),
        Seed::from(bump_seed.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    CreateAccount {
        from: admin,
        to: config_pda,
        lamports,
        space: CONFIG_ACCOUNT_SPACE as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    let cfg = KbrConfig {
        admin: *admin.key(),
        cbbtc_mint: args.cbbtc_mint,
        knect_mint: args.knect_mint,
        vault_cbbtc: args.vault_cbbtc,
        fee_bps: args.fee_bps,
        knect_supply: args.knect_supply,
        btc_in_vault: 0,
        total_redeemed_knect: 0,
        total_fee_btc: 0,
        redemptions_count: 0,
        bump,
        schema_version: 1,
    };
    write_config(config_pda, &cfg)?;
    log!("KbrInitialized fee_bps={} supply={}", args.fee_bps, args.knect_supply);
    Ok(())
}

// =============================================================================
// 0x01 deposit_reserve — add cbBTC to the vault (DCA orchestrator)
// =============================================================================
//
// Accounts:
//   [0] depositor        (signer; owner of source_cbbtc)
//   [1] config_pda       (writable)
//   [2] source_cbbtc     (writable)
//   [3] vault_cbbtc      (writable; must match config.vault_cbbtc)
//   [4] cbbtc_mint       (readonly)
//   [5] token_program

fn deposit_reserve(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let args = DepositReserveArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    if args.amount == 0 {
        return Err(ProgramError::Custom(err::AMOUNT_ZERO));
    }

    let [depositor, config_pda, source_cbbtc, vault_cbbtc, cbbtc_mint, token_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !depositor.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }
    if token_program.key() != &SPL_TOKEN_PROGRAM_ID {
        return Err(ProgramError::Custom(err::WRONG_TOKEN_PROGRAM));
    }

    let mut cfg = read_config(config_pda)?;
    if vault_cbbtc.key() != &cfg.vault_cbbtc {
        return Err(ProgramError::Custom(err::VAULT_MISMATCH));
    }
    if cbbtc_mint.key() != &cfg.cbbtc_mint {
        return Err(ProgramError::Custom(err::MINT_MISMATCH));
    }

    let decimals = mint_decimals(cbbtc_mint)?;
    spl_transfer_checked(
        token_program,
        source_cbbtc,
        cbbtc_mint,
        vault_cbbtc,
        depositor,
        args.amount,
        decimals,
        &[],
    )?;

    cfg.btc_in_vault = cfg
        .btc_in_vault
        .checked_add(args.amount)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    write_config(config_pda, &cfg)?;
    log!("KbrDeposit amount={} btc_in_vault={}", args.amount, cfg.btc_in_vault);
    Ok(())
}

// =============================================================================
// 0x02 redeem — sovereign redemption (the core)
// =============================================================================
//
// Accounts:
//   [0] holder           (signer, writable; burns own KNECT)
//   [1] config_pda       (writable)
//   [2] knect_mint       (writable; burn decreases supply — must match config)
//   [3] holder_knect     (writable; KNECT burned from here)
//   [4] vault_cbbtc      (writable; cbBTC out — must match config, PDA-owned)
//   [5] holder_cbbtc     (writable; cbBTC in)
//   [6] cbbtc_mint       (readonly; for transfer_checked decimals — must match config)
//   [7] token_program

fn redeem(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let args = RedeemArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    if args.knect_amount == 0 {
        return Err(ProgramError::Custom(err::AMOUNT_ZERO));
    }

    let [holder, config_pda, knect_mint, holder_knect, vault_cbbtc, holder_cbbtc, cbbtc_mint, token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !holder.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }
    if token_program.key() != &SPL_TOKEN_PROGRAM_ID {
        return Err(ProgramError::Custom(err::WRONG_TOKEN_PROGRAM));
    }

    let mut cfg = read_config(config_pda)?;
    if vault_cbbtc.key() != &cfg.vault_cbbtc {
        return Err(ProgramError::Custom(err::VAULT_MISMATCH));
    }
    if knect_mint.key() != &cfg.knect_mint {
        return Err(ProgramError::Custom(err::MINT_MISMATCH));
    }
    if cbbtc_mint.key() != &cfg.cbbtc_mint {
        return Err(ProgramError::Custom(err::MINT_MISMATCH));
    }
    if args.knect_amount > cfg.knect_supply {
        return Err(ProgramError::Custom(err::SUPPLY_EXCEEDED));
    }
    if cfg.btc_in_vault == 0 {
        return Err(ProgramError::Custom(err::RESERVE_EMPTY));
    }

    // gross = knect_amount * btc_in_vault / knect_supply  (proportional)
    let gross = (args.knect_amount as u128)
        .checked_mul(cfg.btc_in_vault as u128)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?
        / (cfg.knect_supply as u128);
    // fee = gross * fee_bps / 10_000  (retained in the vault)
    let fee = gross
        .checked_mul(cfg.fee_bps as u128)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?
        / (TOTAL_BPS as u128);
    let net = gross
        .checked_sub(fee)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;

    let knect_decimals = mint_decimals(knect_mint)?;
    let cbbtc_decimals = mint_decimals(cbbtc_mint)?;

    // 1) Burn the redeemed KNECT — authority is the holder (signs their own account).
    spl_burn(token_program, holder_knect, knect_mint, holder, args.knect_amount, &[])?;

    // 2) Pay net cbBTC out of the vault — authority is the config PDA (invoke_signed).
    let bump_seed = [cfg.bump];
    let admin_key = cfg.admin;
    let seeds: [Seed; 3] = [
        Seed::from(CONFIG_SEED),
        Seed::from(admin_key.as_slice()),
        Seed::from(bump_seed.as_slice()),
    ];
    let pda_signer = Signer::from(&seeds);

    // Defensive: confirm the vault authority PDA matches this program's config PDA.
    let (expected_pda, _b) = find_program_address(&[CONFIG_SEED, &admin_key], program_id);
    if config_pda.key() != &expected_pda {
        return Err(ProgramError::Custom(err::WRONG_PDA));
    }

    if net > 0 {
        spl_transfer_checked(
            token_program,
            vault_cbbtc,
            cbbtc_mint,
            holder_cbbtc,
            config_pda,
            net as u64,
            cbbtc_decimals,
            &[pda_signer],
        )?;
    }

    // 3) Update state — denominator falls, fee stays, floor of remainder rises.
    cfg.knect_supply = cfg
        .knect_supply
        .checked_sub(args.knect_amount)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    cfg.btc_in_vault = cfg
        .btc_in_vault
        .checked_sub(net as u64)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    cfg.total_redeemed_knect = cfg
        .total_redeemed_knect
        .checked_add(args.knect_amount)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    cfg.total_fee_btc = cfg
        .total_fee_btc
        .checked_add(fee as u64)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    cfg.redemptions_count = cfg
        .redemptions_count
        .checked_add(1)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    write_config(config_pda, &cfg)?;

    let _ = knect_decimals; // burn uses raw amount; decimals read for parity/forward-compat
    log!(
        "KbrRedeem knect={} net_btc={} fee_btc={}",
        args.knect_amount,
        net as u64,
        fee as u64
    );
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

fn write_config(account: &AccountInfo, cfg: &KbrConfig) -> ProgramResult {
    let mut data = account.try_borrow_mut_data()?;
    if data.len() < CONFIG_ACCOUNT_SPACE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[0..8].copy_from_slice(&KBR_CONFIG_DISCRIMINATOR);
    let mut cursor = &mut data[8..];
    cfg.serialize(&mut cursor)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

fn read_config(account: &AccountInfo) -> Result<KbrConfig, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 + 1 {
        return Err(ProgramError::Custom(err::NOT_INITIALIZED));
    }
    if &data[0..8] != KBR_CONFIG_DISCRIMINATOR {
        return Err(ProgramError::Custom(err::NOT_INITIALIZED));
    }
    KbrConfig::try_from_slice(&data[8..]).map_err(|_| ProgramError::InvalidAccountData)
}

/// Read the decimals byte (offset 44) from an SPL Token v1 Mint account.
fn mint_decimals(mint: &AccountInfo) -> Result<u8, ProgramError> {
    let data = mint.try_borrow_data()?;
    if data.len() < 45 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(data[44])
}

/// Manual SPL Token `TransferChecked` (index 12) CPI.
/// accounts: [source(w), mint(r), destination(w), authority(s)]
fn spl_transfer_checked(
    token_program: &AccountInfo,
    source: &AccountInfo,
    mint: &AccountInfo,
    destination: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    decimals: u8,
    signers: &[Signer],
) -> ProgramResult {
    let mut ix_data = Vec::with_capacity(10);
    ix_data.push(12u8);
    ix_data.extend_from_slice(&amount.to_le_bytes());
    ix_data.push(decimals);

    let metas = [
        AccountMeta { pubkey: source.key(), is_writable: true, is_signer: false },
        AccountMeta { pubkey: mint.key(), is_writable: false, is_signer: false },
        AccountMeta { pubkey: destination.key(), is_writable: true, is_signer: false },
        AccountMeta { pubkey: authority.key(), is_writable: false, is_signer: true },
    ];
    let ix = Instruction { program_id: token_program.key(), accounts: &metas, data: &ix_data };
    invoke_signed::<4>(&ix, &[source, mint, destination, authority], signers)
}

/// Manual SPL Token `Burn` (index 8) CPI.
/// accounts: [account(w), mint(w), authority(s)]
fn spl_burn(
    token_program: &AccountInfo,
    account: &AccountInfo,
    mint: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    let mut ix_data = Vec::with_capacity(9);
    ix_data.push(8u8);
    ix_data.extend_from_slice(&amount.to_le_bytes());

    let metas = [
        AccountMeta { pubkey: account.key(), is_writable: true, is_signer: false },
        AccountMeta { pubkey: mint.key(), is_writable: true, is_signer: false },
        AccountMeta { pubkey: authority.key(), is_writable: false, is_signer: true },
    ];
    let ix = Instruction { program_id: token_program.key(), accounts: &metas, data: &ix_data };
    invoke_signed::<3>(&ix, &[account, mint, authority], signers)
}
