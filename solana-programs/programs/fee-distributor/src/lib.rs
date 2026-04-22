//! DPO2U Fee Distributor
//!
//! Atomic splitter for incoming deposits:
//!   70% → treasury vault (DPO2U reserve)
//!   20% → operator vault  (agent owner, if set — else routes to treasury)
//!   10% → compliance-reserve vault (funds future audits / legal buffer)
//!
//! `distribute` computes the split with checked arithmetic and performs three
//! inline `anchor_spl::token::transfer_checked` CPIs (source → treasury,
//! operator, reserve) signed by `source` authority. All three succeed or the
//! whole ix reverts — atomicity guaranteed by Solana's tx semantics.
//!
//! # v2 roadmap
//! - Swap `source` Signer for a PDA-owned escrow (seeds `[b"fee_source", &nonce]`)
//!   so payment-gateway can CPI into distribute atomically without a second
//!   signer — enables "pay + split" in one tx.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x");

pub const TREASURY_BPS: u16 = 7000; // 70%
pub const OPERATOR_BPS: u16 = 2000; // 20%
pub const RESERVE_BPS: u16 = 1000;  // 10%
pub const TOTAL_BPS: u16 = 10_000;

#[program]
pub mod fee_distributor {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        treasury: Pubkey,
        operator: Pubkey,
        reserve: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.treasury = treasury;
        cfg.operator = operator;
        cfg.reserve = reserve;
        cfg.total_distributed = 0;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Atomically split `amount` 70/20/10 via 3 SPL Token transfer_checked CPIs.
    /// `source` signer must have authority over `source_ata`; the 3 destination
    /// ATAs must match `config.treasury/operator/reserve` owners and all share
    /// the same `mint`.
    pub fn distribute(ctx: Context<Distribute>, amount: u64) -> Result<()> {
        let cfg_treasury = ctx.accounts.config.treasury;
        let cfg_operator = ctx.accounts.config.operator;
        let cfg_reserve = ctx.accounts.config.reserve;
        let mint_key = ctx.accounts.mint.key();

        require_keys_eq!(ctx.accounts.source_ata.mint, mint_key, FeeErr::MintMismatch);
        require_keys_eq!(ctx.accounts.treasury_ata.mint, mint_key, FeeErr::MintMismatch);
        require_keys_eq!(ctx.accounts.operator_ata.mint, mint_key, FeeErr::MintMismatch);
        require_keys_eq!(ctx.accounts.reserve_ata.mint, mint_key, FeeErr::MintMismatch);
        require_keys_eq!(ctx.accounts.treasury_ata.owner, cfg_treasury, FeeErr::VaultOwnerMismatch);
        require_keys_eq!(ctx.accounts.operator_ata.owner, cfg_operator, FeeErr::VaultOwnerMismatch);
        require_keys_eq!(ctx.accounts.reserve_ata.owner, cfg_reserve, FeeErr::VaultOwnerMismatch);

        let treasury_share = (amount as u128)
            .checked_mul(TREASURY_BPS as u128)
            .and_then(|x| x.checked_div(TOTAL_BPS as u128))
            .map(|x| x as u64)
            .ok_or(FeeErr::MathOverflow)?;
        let operator_share = (amount as u128)
            .checked_mul(OPERATOR_BPS as u128)
            .and_then(|x| x.checked_div(TOTAL_BPS as u128))
            .map(|x| x as u64)
            .ok_or(FeeErr::MathOverflow)?;
        let reserve_share = amount
            .checked_sub(treasury_share)
            .and_then(|x| x.checked_sub(operator_share))
            .ok_or(FeeErr::MathOverflow)?;

        let decimals = ctx.accounts.mint.decimals;
        do_transfer(&ctx, &ctx.accounts.treasury_ata, treasury_share, decimals)?;
        do_transfer(&ctx, &ctx.accounts.operator_ata, operator_share, decimals)?;
        do_transfer(&ctx, &ctx.accounts.reserve_ata, reserve_share, decimals)?;

        let cfg = &mut ctx.accounts.config;
        cfg.total_distributed = cfg.total_distributed.checked_add(amount).ok_or(FeeErr::MathOverflow)?;

        emit!(FeeDistributed {
            amount,
            treasury_share,
            operator_share,
            reserve_share,
            treasury: cfg_treasury,
            operator: cfg_operator,
            reserve: cfg_reserve,
        });
        Ok(())
    }
}

fn do_transfer<'info>(
    ctx: &Context<Distribute<'info>>,
    dest: &Account<'info, TokenAccount>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.source_ata.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: dest.to_account_info(),
            authority: ctx.accounts.source.to_account_info(),
        },
    );
    token::transfer_checked(cpi_ctx, amount, decimals)
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub operator: Pubkey,
    pub reserve: Pubkey,
    pub total_distributed: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"fee_config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Distribute<'info> {
    #[account(mut, seeds = [b"fee_config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub source: Signer<'info>,
    #[account(mut)]
    pub source_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub operator_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub reserve_ata: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct FeeDistributed {
    pub amount: u64,
    pub treasury_share: u64,
    pub operator_share: u64,
    pub reserve_share: u64,
    pub treasury: Pubkey,
    pub operator: Pubkey,
    pub reserve: Pubkey,
}

#[error_code]
pub enum FeeErr {
    #[msg("arithmetic overflow when computing shares")]
    MathOverflow,
    #[msg("token account mint does not match the mint argument")]
    MintMismatch,
    #[msg("vault ATA owner does not match config.treasury/operator/reserve")]
    VaultOwnerMismatch,
}
