//! DPO2U Consent Manager — India DPDP Rules 2025 (§6 + Capítulo 2).
//!
//! Registers per-user consent events as PDAs keyed by (user, data_fiduciary,
//! purpose_hash). Records the minimal DPDP §6 fields: purpose code, purpose
//! hash (off-chain text), optional expiry, optional storage_uri (for off-chain
//! evidence), and a revocation flag.
//!
//! Two instruction paths (mirror of compliance-registry):
//!   - `record_consent` — caller-asserted purpose_hash (trusted fiduciary).
//!   - `record_verified_consent` — CPI to `dpo2u-compliance-verifier` first;
//!      purpose_hash is bound to a Groth16 proof's subject_commitment so the
//!      fiduciary cannot attest consent the user never gave.
//!
//! The verified path reuses the same SP1 v6 verifier program that the
//! compliance-registry uses — we do NOT ship a second verifier.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};

declare_id!("D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB");

/// Shared SP1 v6 verifier address — same program used by compliance-registry.
/// Update here if verifier is ever redeployed (keep in sync with
/// `programs/compliance-registry/src/lib.rs::verifier::ID`).
pub mod verifier {
    use anchor_lang::prelude::*;
    declare_id!("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");
}

/// Borsh-serializable proof envelope — identical wire format to the one used
/// by compliance-registry and the sp1-solana verifier. Kept local here to
/// avoid a workspace dep for a 3-field struct.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SP1Groth16Proof {
    pub proof: Vec<u8>,
    pub sp1_public_inputs: Vec<u8>,
}

#[program]
pub mod consent_manager {
    use super::*;

    /// Record a consent event (trusted-fiduciary path).
    ///
    /// The `purpose_hash` (SHA-256 of the human-readable purpose text) is
    /// caller-asserted. Anyone verifying the on-chain record must cross-check
    /// the hash against an off-chain purpose statement (typically fetched from
    /// `storage_uri`).
    pub fn record_consent(
        ctx: Context<RecordConsent>,
        purpose_code: u16,
        purpose_hash: [u8; 32],
        storage_uri: String,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, ConsentErr::StorageUriTooLong);

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.consent;
        rec.user = ctx.accounts.user.key();
        rec.data_fiduciary = ctx.accounts.data_fiduciary.key();
        rec.purpose_code = purpose_code;
        rec.purpose_hash = purpose_hash;
        rec.storage_uri = storage_uri;
        rec.issued_at = clock.unix_timestamp;
        rec.expires_at = expires_at;
        rec.revoked_at = None;
        rec.revocation_reason = None;
        rec.version = 1;
        rec.bump = ctx.bumps.consent;
        rec.verified = false;
        rec.threshold = 0;

        emit!(ConsentRecorded {
            user: rec.user,
            data_fiduciary: rec.data_fiduciary,
            purpose_code,
            purpose_hash,
            issued_at: rec.issued_at,
            verified: false,
        });
        Ok(())
    }

    /// Record a consent event with ZK binding.
    ///
    /// The SP1 proof's `subject_commitment` (bytes [32..64] of public_inputs)
    /// MUST equal the `purpose_hash` argument. This binds the PDA address to
    /// the exact proof — preventing a fiduciary from swapping proofs after
    /// attestation.
    pub fn record_verified_consent(
        ctx: Context<RecordVerifiedConsent>,
        purpose_code: u16,
        purpose_hash: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
        storage_uri: String,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, ConsentErr::StorageUriTooLong);
        require!(proof.len() == 356, ConsentErr::InvalidProofSize);
        require!(public_inputs.len() == 96, ConsentErr::InvalidPublicValuesSize);

        // Same ABI layout as compliance-registry:
        //   bytes [0..32]    uint32 threshold (u32 big-endian in last 4 bytes)
        //   bytes [32..64]   bytes32 subject_commitment (= purpose_hash here)
        //   bytes [64..96]   bool meets_threshold (in last byte)
        let threshold_bytes: [u8; 4] = public_inputs[28..32]
            .try_into()
            .map_err(|_| ConsentErr::MalformedPublicValues)?;
        let threshold = u32::from_be_bytes(threshold_bytes);
        let decoded_commitment: [u8; 32] = public_inputs[32..64]
            .try_into()
            .map_err(|_| ConsentErr::MalformedPublicValues)?;
        let meets_threshold = public_inputs[95] != 0;

        require!(purpose_hash == decoded_commitment, ConsentErr::PurposeMismatch);
        require!(meets_threshold, ConsentErr::ThresholdNotMet);

        let proof_envelope = SP1Groth16Proof {
            proof,
            sp1_public_inputs: public_inputs,
        };
        let mut ix_data = Vec::with_capacity(
            8 + proof_envelope.proof.len() + proof_envelope.sp1_public_inputs.len(),
        );
        proof_envelope
            .serialize(&mut ix_data)
            .map_err(|_| ConsentErr::ProofSerializationFailed)?;

        let verifier_ix = Instruction {
            program_id: ctx.accounts.verifier_program.key(),
            accounts: vec![],
            data: ix_data,
        };
        invoke(&verifier_ix, &[ctx.accounts.verifier_program.to_account_info()])
            .map_err(|_| ConsentErr::VerificationFailed)?;

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.consent;
        rec.user = ctx.accounts.user.key();
        rec.data_fiduciary = ctx.accounts.data_fiduciary.key();
        rec.purpose_code = purpose_code;
        rec.purpose_hash = purpose_hash;
        rec.storage_uri = storage_uri;
        rec.issued_at = clock.unix_timestamp;
        rec.expires_at = expires_at;
        rec.revoked_at = None;
        rec.revocation_reason = None;
        rec.version = 1;
        rec.bump = ctx.bumps.consent;
        rec.verified = true;
        rec.threshold = threshold;

        emit!(ConsentRecorded {
            user: rec.user,
            data_fiduciary: rec.data_fiduciary,
            purpose_code,
            purpose_hash,
            issued_at: rec.issued_at,
            verified: true,
        });
        emit!(VerifiedConsentRecorded {
            user: rec.user,
            data_fiduciary: rec.data_fiduciary,
            purpose_hash,
            threshold,
            verifier_program: ctx.accounts.verifier_program.key(),
            issued_at: rec.issued_at,
        });
        Ok(())
    }

    /// Revoke a consent event.
    ///
    /// Only the `user` who granted consent can revoke it — a data fiduciary
    /// cannot revoke on the user's behalf (DPDP §6(4) right to withdraw).
    pub fn revoke_consent(ctx: Context<RevokeConsent>, reason: String) -> Result<()> {
        require!(reason.len() <= 64, ConsentErr::ReasonTooLong);

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.consent;
        require!(rec.revoked_at.is_none(), ConsentErr::AlreadyRevoked);
        require_keys_eq!(rec.user, ctx.accounts.user.key(), ConsentErr::Unauthorized);

        rec.revoked_at = Some(clock.unix_timestamp);
        rec.revocation_reason = Some(reason.clone());

        emit!(ConsentRevoked {
            user: rec.user,
            data_fiduciary: rec.data_fiduciary,
            purpose_hash: rec.purpose_hash,
            reason,
            revoked_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct ConsentRecord {
    pub user: Pubkey,
    pub data_fiduciary: Pubkey,
    pub purpose_code: u16,
    pub purpose_hash: [u8; 32],
    #[max_len(128)]
    pub storage_uri: String,
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    #[max_len(64)]
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub bump: u8,
    /// True when created via `record_verified_consent` (ZK-bound).
    pub verified: bool,
    /// Threshold from the SP1 proof (0 when not verified).
    pub threshold: u32,
}

#[derive(Accounts)]
#[instruction(_purpose_code: u16, purpose_hash: [u8; 32])]
pub struct RecordConsent<'info> {
    #[account(mut)]
    pub data_fiduciary: Signer<'info>,
    /// CHECK: user key is any pubkey (citizen wallet / DID controller)
    pub user: AccountInfo<'info>,
    #[account(
        init,
        payer = data_fiduciary,
        space = 8 + ConsentRecord::INIT_SPACE,
        seeds = [
            b"consent",
            user.key().as_ref(),
            data_fiduciary.key().as_ref(),
            &purpose_hash,
        ],
        bump
    )]
    pub consent: Account<'info, ConsentRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_purpose_code: u16, purpose_hash: [u8; 32])]
pub struct RecordVerifiedConsent<'info> {
    #[account(mut)]
    pub data_fiduciary: Signer<'info>,
    /// CHECK: user key is any pubkey (citizen wallet / DID controller)
    pub user: AccountInfo<'info>,
    #[account(
        init,
        payer = data_fiduciary,
        space = 8 + ConsentRecord::INIT_SPACE,
        seeds = [
            b"consent",
            user.key().as_ref(),
            data_fiduciary.key().as_ref(),
            &purpose_hash,
        ],
        bump
    )]
    pub consent: Account<'info, ConsentRecord>,
    /// CHECK: address-constrained to the known SP1 verifier program.
    #[account(address = verifier::ID)]
    pub verifier_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeConsent<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"consent",
            consent.user.as_ref(),
            consent.data_fiduciary.as_ref(),
            &consent.purpose_hash,
        ],
        bump = consent.bump
    )]
    pub consent: Account<'info, ConsentRecord>,
}

// -- Events --

#[event]
pub struct ConsentRecorded {
    pub user: Pubkey,
    pub data_fiduciary: Pubkey,
    pub purpose_code: u16,
    pub purpose_hash: [u8; 32],
    pub issued_at: i64,
    pub verified: bool,
}

#[event]
pub struct VerifiedConsentRecorded {
    pub user: Pubkey,
    pub data_fiduciary: Pubkey,
    pub purpose_hash: [u8; 32],
    pub threshold: u32,
    pub verifier_program: Pubkey,
    pub issued_at: i64,
}

#[event]
pub struct ConsentRevoked {
    pub user: Pubkey,
    pub data_fiduciary: Pubkey,
    pub purpose_hash: [u8; 32],
    pub reason: String,
    pub revoked_at: i64,
}

// -- Errors --

#[error_code]
pub enum ConsentErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("revocation reason exceeds 64 bytes")]
    ReasonTooLong,
    #[msg("consent already revoked")]
    AlreadyRevoked,
    #[msg("only the user who granted consent can revoke it (DPDP §6(4))")]
    Unauthorized,
    #[msg("proof bytes must be exactly 356 (SP1 v6 Groth16 layout)")]
    InvalidProofSize,
    #[msg("public_inputs must be 96 bytes (ABI-encoded PublicValuesStruct)")]
    InvalidPublicValuesSize,
    #[msg("could not parse PublicValuesStruct from public_inputs bytes")]
    MalformedPublicValues,
    #[msg("purpose_hash argument does not match subject_commitment inside proof")]
    PurposeMismatch,
    #[msg("proof's meets_threshold flag is false — consent does not meet policy")]
    ThresholdNotMet,
    #[msg("failed to Borsh-serialize SP1Groth16Proof for CPI")]
    ProofSerializationFailed,
    #[msg("CPI to dpo2u-compliance-verifier failed — proof did not verify")]
    VerificationFailed,
}
