//! DPO2U Fee Distributor
//!
//! Stateless splitter for incoming deposits:
//!   70% → treasury vault (DPO2U reserve)
//!   20% → operator vault  (agent owner, if set — else routes to treasury)
//!   10% → compliance-reserve vault (funds future audits / legal buffer)
//!
//! Scaffolded: `distribute` computes the split with checked arithmetic and
//! emits `FeeDistributed` — the caller (payment-gateway or MCP orchestrator)
//! is responsible for moving SPL tokens to the three vault ATAs that match
//! the emitted amounts.
//!
//! # Roadmap (post-hackathon v2)
//! - Wire `distribute` to perform 3 inline `anchor_spl::token::transfer` CPIs
//!   signed by a PDA-owned source account. Accounts needed on `Distribute`:
//!   source_ata, treasury_ata, operator_ata, reserve_ata, mint, token_program.
//! - PDA signer seeds: `[b"fee_source", &nonce]` — deterministic per tx.
//! - Atomicity guarantee: all 3 transfers succeed or the whole ix reverts.

use anchor_lang::prelude::*;

declare_id!("9M88ZwVVrY5HF3T1XhuN1Hwen9YX7885c3TMed7u9zRd");

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

    /// Stateless split record. Caller transfers SPL Token amounts that match
    /// the emitted split before invoking (CPI version comes in Sprint 4).
    pub fn distribute(ctx: Context<Distribute>, amount: u64) -> Result<()> {
        let cfg = &mut ctx.accounts.config;

        let treasury_share = amount
            .checked_mul(TREASURY_BPS as u64)
            .and_then(|x| x.checked_div(TOTAL_BPS as u64))
            .ok_or(FeeErr::MathOverflow)?;
        let operator_share = amount
            .checked_mul(OPERATOR_BPS as u64)
            .and_then(|x| x.checked_div(TOTAL_BPS as u64))
            .ok_or(FeeErr::MathOverflow)?;
        let reserve_share = amount
            .checked_sub(treasury_share)
            .and_then(|x| x.checked_sub(operator_share))
            .ok_or(FeeErr::MathOverflow)?;

        cfg.total_distributed = cfg.total_distributed.checked_add(amount).ok_or(FeeErr::MathOverflow)?;

        emit!(FeeDistributed {
            amount,
            treasury_share,
            operator_share,
            reserve_share,
            treasury: cfg.treasury,
            operator: cfg.operator,
            reserve: cfg.reserve,
        });
        Ok(())
    }
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
}
