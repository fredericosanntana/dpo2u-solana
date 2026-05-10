#![allow(deprecated, unexpected_cfgs)]

//! DPO2U PIPEDA Consent Extension — Canada PIPEDA Schedule 1.
//!
//! PIPEDA structures privacy obligations as 10 fair-information principles
//! (Schedule 1). Principle 4 (Consent) requires consent be:
//!   - knowledge + understanding of purpose (4.3.2)
//!   - express OR implied based on sensitivity (4.3.6)
//!   - withdrawable at any time (4.3.8)
//!   - meaningful (Schrems-Stoddart-Bracken-Cazares jurisprudence — OPC
//!     Findings 2014-005, 2018-002).
//!
//! This program extends `consent_manager` (DPDP-shaped) with PIPEDA-specific
//! fields:
//!   - `consent_form` (express|implied|opt_out_in_limited_circumstances)
//!   - `principle_evidence` (which of the 10 principles are addressed)
//!   - `breach_threshold_crossed` flag (DPA 2018 §10.1 RROSH — Real Risk Of
//!      Significant Harm — when set, OPC notification within 'as soon as
//!      feasible' is mandated; primitive captures awareness on-chain).
//!
//! Use cases:
//!   - Granular evidence trail per OPC complaint investigations.
//!   - Verifiable history of consent withdrawal (Principle 4.3.8).
//!   - Cross-border data flow attestation (Principle 4.1.3 accountability).

use anchor_lang::prelude::*;

declare_id!("G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT");

/// PIPEDA consent forms (Schedule 1, Principle 4.3.6).
pub const CONSENT_EXPRESS: u8 = 1;     // explicit, signed/clicked
pub const CONSENT_IMPLIED: u8 = 2;     // reasonable expectation
pub const CONSENT_OPT_OUT: u8 = 3;     // opt-out in limited circumstances (4.3.6)

#[program]
pub mod pipeda_consent_extension {
    use super::*;

    /// Record a PIPEDA-shaped consent event.
    ///
    /// `principles_evidenced` is a u16 bitmap where bit N (1-indexed) marks
    /// Schedule 1 Principle N as evidenced by this record. Common values:
    ///   - 0b0000_0000_1111_1110 (0xFE) → Principles 2-8 (most active duties)
    ///   - 0b0000_0011_1111_1110 (0x3FE) → Principles 2-9 (full minus 1+10)
    pub fn record_pipeda_consent(
        ctx: Context<RecordPipedaConsent>,
        purpose_code: u16,
        purpose_hash: [u8; 32],
        consent_form: u8,
        principles_evidenced: u16,
        cross_border_destination: Option<[u8; 2]>, // ISO-3166-1 alpha-2
        storage_uri: String,
    ) -> Result<()> {
        require!(
            matches!(consent_form, CONSENT_EXPRESS | CONSENT_IMPLIED | CONSENT_OPT_OUT),
            PipedaErr::InvalidConsentForm
        );
        require!(storage_uri.len() <= 128, PipedaErr::StorageUriTooLong);

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.consent;
        rec.subject = ctx.accounts.subject.key();
        rec.organization = ctx.accounts.organization.key();
        rec.purpose_code = purpose_code;
        rec.purpose_hash = purpose_hash;
        rec.consent_form = consent_form;
        rec.principles_evidenced = principles_evidenced;
        rec.cross_border_destination = cross_border_destination;
        rec.storage_uri = storage_uri;
        rec.issued_at = clock.unix_timestamp;
        rec.withdrawn_at = None;
        rec.withdrawal_reason = None;
        rec.breach_threshold_crossed = false;
        rec.version = 1;
        rec.bump = ctx.bumps.consent;

        emit!(PipedaConsentRecorded {
            subject: rec.subject,
            organization: rec.organization,
            purpose_code,
            consent_form,
            principles_evidenced,
            issued_at: rec.issued_at,
        });
        Ok(())
    }

    /// Withdraw consent (PIPEDA Principle 4.3.8 — subject right).
    /// Only the subject can withdraw.
    pub fn withdraw_consent(
        ctx: Context<WithdrawConsent>,
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 64, PipedaErr::ReasonTooLong);
        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.consent;
        require_keys_eq!(rec.subject, ctx.accounts.subject.key(), PipedaErr::Unauthorized);
        require!(rec.withdrawn_at.is_none(), PipedaErr::AlreadyWithdrawn);
        rec.withdrawn_at = Some(clock.unix_timestamp);
        rec.withdrawal_reason = Some(reason.clone());

        emit!(PipedaConsentWithdrawn {
            subject: rec.subject,
            organization: rec.organization,
            reason,
            withdrawn_at: clock.unix_timestamp,
        });
        Ok(())
    }

    /// Flag a Real Risk Of Significant Harm (RROSH) — Digital Privacy Act §10.1.
    /// Only the organization may flag (after internal investigation).
    /// Once flagged, OPC notification timer kicks in ('as soon as feasible').
    pub fn flag_rrosh(ctx: Context<FlagRrosh>) -> Result<()> {
        let rec = &mut ctx.accounts.consent;
        require_keys_eq!(
            rec.organization,
            ctx.accounts.organization.key(),
            PipedaErr::Unauthorized
        );
        require!(!rec.breach_threshold_crossed, PipedaErr::AlreadyFlagged);
        rec.breach_threshold_crossed = true;

        emit!(RroshFlagged {
            subject: rec.subject,
            organization: rec.organization,
            flagged_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct PipedaConsentRecord {
    pub subject: Pubkey,
    pub organization: Pubkey,
    pub purpose_code: u16,
    pub purpose_hash: [u8; 32],
    pub consent_form: u8,           // 1=express, 2=implied, 3=opt_out
    pub principles_evidenced: u16,  // bitmap principles 1-10
    pub cross_border_destination: Option<[u8; 2]>, // ISO country code (Principle 4.1.3)
    #[max_len(128)]
    pub storage_uri: String,
    pub issued_at: i64,
    pub withdrawn_at: Option<i64>,
    #[max_len(64)]
    pub withdrawal_reason: Option<String>,
    pub breach_threshold_crossed: bool, // RROSH flag
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(_purpose_code: u16, purpose_hash: [u8; 32])]
pub struct RecordPipedaConsent<'info> {
    #[account(mut)]
    pub organization: Signer<'info>,
    /// CHECK: subject pubkey
    pub subject: AccountInfo<'info>,
    #[account(
        init,
        payer = organization,
        space = 8 + PipedaConsentRecord::INIT_SPACE,
        seeds = [
            b"pipeda_consent",
            subject.key().as_ref(),
            organization.key().as_ref(),
            &purpose_hash,
        ],
        bump
    )]
    pub consent: Account<'info, PipedaConsentRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawConsent<'info> {
    pub subject: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"pipeda_consent",
            consent.subject.as_ref(),
            consent.organization.as_ref(),
            &consent.purpose_hash,
        ],
        bump = consent.bump
    )]
    pub consent: Account<'info, PipedaConsentRecord>,
}

#[derive(Accounts)]
pub struct FlagRrosh<'info> {
    pub organization: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"pipeda_consent",
            consent.subject.as_ref(),
            consent.organization.as_ref(),
            &consent.purpose_hash,
        ],
        bump = consent.bump
    )]
    pub consent: Account<'info, PipedaConsentRecord>,
}

// -- Events --

#[event]
pub struct PipedaConsentRecorded {
    pub subject: Pubkey,
    pub organization: Pubkey,
    pub purpose_code: u16,
    pub consent_form: u8,
    pub principles_evidenced: u16,
    pub issued_at: i64,
}

#[event]
pub struct PipedaConsentWithdrawn {
    pub subject: Pubkey,
    pub organization: Pubkey,
    pub reason: String,
    pub withdrawn_at: i64,
}

#[event]
pub struct RroshFlagged {
    pub subject: Pubkey,
    pub organization: Pubkey,
    pub flagged_at: i64,
}

// -- Errors --

#[error_code]
pub enum PipedaErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("withdrawal reason exceeds 64 bytes")]
    ReasonTooLong,
    #[msg("consent_form must be 1 (express), 2 (implied), or 3 (opt-out)")]
    InvalidConsentForm,
    #[msg("consent already withdrawn")]
    AlreadyWithdrawn,
    #[msg("RROSH already flagged")]
    AlreadyFlagged,
    #[msg("only the data subject can withdraw consent (Principle 4.3.8)")]
    Unauthorized,
}
