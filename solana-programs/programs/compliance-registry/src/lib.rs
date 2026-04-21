//! DPO2U Compliance Registry
//!
//! Stores per-subject attestations anchoring an off-chain DPIA/audit/policy
//! document. Each attestation is a PDA keyed by (subject, commitment), making
//! re-registration of the same document idempotent (constraint fails on 2nd).
//!
//! Public-input inspired by Solana Attestation Service (SAS); payload stays
//! project-defined so we can evolve schemas without SAS governance coupling.
//!
//! Sprint 3 scaffolding — tests via LiteSVM come in `tests/` sibling.

use anchor_lang::prelude::*;

declare_id!("FrvXc4bqCG3268LVaLR3nwogWmDsVwnSqRE6M1dcdJc3");

#[program]
pub mod compliance_registry {
    use super::*;

    pub fn create_attestation(
        ctx: Context<CreateAttestation>,
        commitment: [u8; 32],
        storage_uri: String,
        schema_id: Pubkey,
        predicates_bitmap: u32,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, ComplianceErr::StorageUriTooLong);

        let clock = Clock::get()?;
        let att = &mut ctx.accounts.attestation;
        att.subject = ctx.accounts.subject.key();
        att.issuer = ctx.accounts.issuer.key();
        att.schema_id = schema_id;
        att.commitment = commitment;
        att.storage_uri = storage_uri;
        att.predicates_bitmap = predicates_bitmap;
        att.issued_at = clock.unix_timestamp;
        att.expires_at = expires_at;
        att.revoked_at = None;
        att.revocation_reason = None;
        att.version = 1;
        att.bump = ctx.bumps.attestation;

        emit!(AttestationCreated {
            subject: att.subject,
            issuer: att.issuer,
            commitment: att.commitment,
            predicates_bitmap: att.predicates_bitmap,
            issued_at: att.issued_at,
        });
        Ok(())
    }

    pub fn revoke_attestation(ctx: Context<RevokeAttestation>, reason: String) -> Result<()> {
        require!(reason.len() <= 64, ComplianceErr::ReasonTooLong);

        let clock = Clock::get()?;
        let att = &mut ctx.accounts.attestation;
        require!(att.revoked_at.is_none(), ComplianceErr::AlreadyRevoked);
        require_keys_eq!(att.issuer, ctx.accounts.issuer.key(), ComplianceErr::Unauthorized);

        att.revoked_at = Some(clock.unix_timestamp);
        att.revocation_reason = Some(reason.clone());

        emit!(AttestationRevoked {
            subject: att.subject,
            commitment: att.commitment,
            reason,
            revoked_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    pub subject: Pubkey,
    pub issuer: Pubkey,
    pub schema_id: Pubkey,
    pub commitment: [u8; 32],
    #[max_len(128)]
    pub storage_uri: String,
    pub predicates_bitmap: u32,
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    #[max_len(64)]
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct CreateAttestation<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    /// CHECK: subject is any pubkey (company wallet, DID controller)
    pub subject: AccountInfo<'info>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [b"attestation", subject.key().as_ref(), &commitment],
        bump
    )]
    pub attestation: Account<'info, Attestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, seeds = [b"attestation", attestation.subject.as_ref(), &attestation.commitment], bump = attestation.bump)]
    pub attestation: Account<'info, Attestation>,
}

// -- Events --

#[event]
pub struct AttestationCreated {
    pub subject: Pubkey,
    pub issuer: Pubkey,
    pub commitment: [u8; 32],
    pub predicates_bitmap: u32,
    pub issued_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub subject: Pubkey,
    pub commitment: [u8; 32],
    pub reason: String,
    pub revoked_at: i64,
}

// -- Errors --

#[error_code]
pub enum ComplianceErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("revocation reason exceeds 64 bytes")]
    ReasonTooLong,
    #[msg("attestation already revoked")]
    AlreadyRevoked,
    #[msg("only the original issuer can revoke")]
    Unauthorized,
}
