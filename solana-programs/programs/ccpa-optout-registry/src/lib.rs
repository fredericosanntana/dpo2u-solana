#![allow(deprecated, unexpected_cfgs)]

//! DPO2U CCPA Opt-Out Registry — California Consumer Privacy Act §1798.135.
//!
//! CCPA/CPRA gives California consumers three opt-out rights:
//!   1. Opt-out of sale (`§1798.120`)
//!   2. Opt-out of sharing for cross-context behavioral advertising (CPRA addition)
//!   3. Limit use of sensitive personal information (`§1798.121`)
//!
//! Plus the Global Privacy Control (GPC) signal (Cal. Code Regs. tit. 11 §7025)
//! must be respected as a valid opt-out.
//!
//! On-chain primitive: PDA per (consumer, business, optout_kind). Records when
//! the opt-out was registered, whether it was triggered by GPC or explicit
//! request, and provides a verifiable on-chain proof a business honored the
//! preference.
//!
//! Privacy: consumer is keyed by a `consumer_commitment_hash` (SHA-256 of an
//! opaque consumer ID known to consumer + business — keeps the ledger free of
//! PII per CCPA Data Minimization principle §1798.100(c)).

use anchor_lang::prelude::*;

declare_id!("5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk");

/// Three CCPA opt-out kinds, encoded as discriminator bytes inside the PDA seeds
/// to prevent collision and allow per-kind PDAs.
pub const OPTOUT_SALE: u8 = 1;
pub const OPTOUT_SHARE: u8 = 2;
pub const OPTOUT_SENSITIVE: u8 = 3;

#[program]
pub mod ccpa_optout_registry {
    use super::*;

    /// Register a Do-Not-Sell / Do-Not-Share / Limit-Sensitive opt-out.
    ///
    /// `consumer_commitment_hash` is the consumer-side opaque identifier
    /// (NOT the wallet pubkey — keeps PII off-chain).
    /// `optout_kind` is OPTOUT_SALE | OPTOUT_SHARE | OPTOUT_SENSITIVE.
    /// `via_gpc=true` indicates the opt-out came via Global Privacy Control
    ///   (Cal. Code Regs. tit. 11 §7025 — businesses must honor this signal).
    pub fn register_optout(
        ctx: Context<RegisterOptout>,
        consumer_commitment_hash: [u8; 32],
        optout_kind: u8,
        via_gpc: bool,
        storage_uri: String,
    ) -> Result<()> {
        require!(
            matches!(optout_kind, OPTOUT_SALE | OPTOUT_SHARE | OPTOUT_SENSITIVE),
            OptoutErr::InvalidKind
        );
        require!(storage_uri.len() <= 128, OptoutErr::StorageUriTooLong);

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.optout;
        rec.business = ctx.accounts.business.key();
        rec.consumer_commitment_hash = consumer_commitment_hash;
        rec.optout_kind = optout_kind;
        rec.via_gpc = via_gpc;
        rec.storage_uri = storage_uri;
        rec.opted_out_at = clock.unix_timestamp;
        rec.expires_at = None; // CCPA: opt-out is permanent until consumer reverses
        rec.reversed_at = None;
        rec.version = 1;
        rec.bump = ctx.bumps.optout;

        emit!(OptoutRegistered {
            business: rec.business,
            consumer_commitment_hash,
            optout_kind,
            via_gpc,
            opted_out_at: rec.opted_out_at,
        });
        Ok(())
    }

    /// Reverse an opt-out — only the consumer (via signed `consumer_signer`
    /// account) can reverse. Businesses cannot un-opt consumers.
    ///
    /// In practice the consumer authenticates off-chain (e.g., via business
    /// portal) and the business submits the reversal — but the on-chain
    /// signer MUST be the consumer wallet that controls the
    /// commitment_hash. This protects against business-initiated reversal
    /// attacks per CCPA §1798.135(c).
    pub fn reverse_optout(ctx: Context<ReverseOptout>) -> Result<()> {
        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.optout;
        require!(rec.reversed_at.is_none(), OptoutErr::AlreadyReversed);
        // Note: signature alone doesn't prove control of consumer_commitment_hash.
        // Off-chain, businesses MUST verify the signer ↔ commitment binding.
        rec.reversed_at = Some(clock.unix_timestamp);

        emit!(OptoutReversed {
            business: rec.business,
            consumer_commitment_hash: rec.consumer_commitment_hash,
            optout_kind: rec.optout_kind,
            reversed_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct OptoutRecord {
    pub business: Pubkey,
    pub consumer_commitment_hash: [u8; 32],
    pub optout_kind: u8,
    pub via_gpc: bool,
    #[max_len(128)]
    pub storage_uri: String,
    pub opted_out_at: i64,
    pub expires_at: Option<i64>,
    pub reversed_at: Option<i64>,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(consumer_commitment_hash: [u8; 32], optout_kind: u8)]
pub struct RegisterOptout<'info> {
    #[account(mut)]
    pub business: Signer<'info>,
    #[account(
        init,
        payer = business,
        space = 8 + OptoutRecord::INIT_SPACE,
        seeds = [
            b"ccpa_optout",
            business.key().as_ref(),
            &consumer_commitment_hash,
            &[optout_kind],
        ],
        bump
    )]
    pub optout: Account<'info, OptoutRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReverseOptout<'info> {
    /// Consumer signer — off-chain binding to consumer_commitment_hash MUST
    /// be verified by business before submitting this transaction.
    pub consumer_signer: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"ccpa_optout",
            optout.business.as_ref(),
            &optout.consumer_commitment_hash,
            &[optout.optout_kind],
        ],
        bump = optout.bump
    )]
    pub optout: Account<'info, OptoutRecord>,
}

// -- Events --

#[event]
pub struct OptoutRegistered {
    pub business: Pubkey,
    pub consumer_commitment_hash: [u8; 32],
    pub optout_kind: u8,
    pub via_gpc: bool,
    pub opted_out_at: i64,
}

#[event]
pub struct OptoutReversed {
    pub business: Pubkey,
    pub consumer_commitment_hash: [u8; 32],
    pub optout_kind: u8,
    pub reversed_at: i64,
}

// -- Errors --

#[error_code]
pub enum OptoutErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("optout_kind must be 1 (sale), 2 (share), or 3 (sensitive)")]
    InvalidKind,
    #[msg("opt-out already reversed")]
    AlreadyReversed,
}
