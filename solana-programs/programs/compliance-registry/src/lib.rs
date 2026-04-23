// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions (custom-heap, solana, etc.); bump to 0.32+
// scheduled for post-Colosseum.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U Compliance Registry
//!
//! Stores per-subject attestations anchoring an off-chain DPIA/audit/policy
//! document. Each attestation is a PDA keyed by (subject, commitment), making
//! re-registration of the same document idempotent (constraint fails on 2nd).
//!
//! Two instruction paths:
//!   - `create_attestation` — caller-asserted commitment (trusted issuer model).
//!   - `create_verified_attestation` — CPI to `dpo2u-compliance-verifier` first;
//!     commitment is bound to a Groth16 ZK proof of `score >= threshold`.
//!
//! The verified path is what the hackathon demo flow uses: the attestation on
//! chain is cryptographically tied to a proof that the subject meets a policy
//! threshold without revealing the score.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};

declare_id!("7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK");

/// On-chain program that verifies SP1 v6 Groth16 proofs.
/// Deployed separately at `sp1-solana/example/program/src/lib.rs`.
///
/// Pinned by address so a malicious caller can't substitute a stub that always
/// returns Ok(). Update this when deploying to devnet/mainnet — the known
/// localnet ID from Sprint 4c is hardcoded below.
pub mod verifier {
    use anchor_lang::prelude::*;
    declare_id!("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");
}

/// Borsh-serializable proof envelope — wire-compatible with
/// `sp1-solana/example/program/src/lib.rs::SP1Groth16Proof`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SP1Groth16Proof {
    pub proof: Vec<u8>,
    pub sp1_public_inputs: Vec<u8>,
}

#[program]
pub mod compliance_registry {
    use super::*;

    /// Legacy path — attestation with caller-asserted commitment.
    /// Kept for backwards compatibility with Sprint 3 clients.
    /// New integrations SHOULD use `create_verified_attestation`.
    pub fn create_attestation(
        ctx: Context<CreateAttestation>,
        commitment: [u8; 32],
        storage_uri: String,
        schema_id: Pubkey,
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
        att.issued_at = clock.unix_timestamp;
        att.expires_at = expires_at;
        att.revoked_at = None;
        att.revocation_reason = None;
        att.version = 1;
        att.bump = ctx.bumps.attestation;
        att.verified = false;
        att.threshold = 0;

        emit!(AttestationCreated {
            subject: att.subject,
            issuer: att.issuer,
            commitment: att.commitment,
            issued_at: att.issued_at,
            verified: false,
        });
        Ok(())
    }

    /// Verified path — CPI to `dpo2u-compliance-verifier` first, then attest.
    ///
    /// The `commitment` seed MUST match `subject_commitment` extracted from the
    /// proof's public values. This binds the PDA address to the exact proof —
    /// you cannot create an attestation with the same (subject, commitment)
    /// keyed to a different proof.
    pub fn create_verified_attestation(
        ctx: Context<CreateVerifiedAttestation>,
        commitment: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
        storage_uri: String,
        schema_id: Pubkey,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, ComplianceErr::StorageUriTooLong);
        require!(proof.len() == 356, ComplianceErr::InvalidProofSize);
        require!(public_inputs.len() == 96, ComplianceErr::InvalidPublicValuesSize);

        // ABI layout of PublicValuesStruct (from dpo2u-zk-lib):
        //   uint32 threshold             → bytes [0..32], big-endian u32 in last 4 bytes
        //   bytes32 subject_commitment   → bytes [32..64]
        //   bool meets_threshold         → bytes [64..96], boolean in last byte
        let threshold_bytes: [u8; 4] = public_inputs[28..32]
            .try_into()
            .map_err(|_| ComplianceErr::MalformedPublicValues)?;
        let threshold = u32::from_be_bytes(threshold_bytes);
        let decoded_commitment: [u8; 32] = public_inputs[32..64]
            .try_into()
            .map_err(|_| ComplianceErr::MalformedPublicValues)?;
        let meets_threshold = public_inputs[95] != 0;

        // Bind PDA seed to proof commitment + require proof actually proves compliance.
        require!(commitment == decoded_commitment, ComplianceErr::CommitmentMismatch);
        require!(meets_threshold, ComplianceErr::ThresholdNotMet);

        // CPI to on-chain verifier — runs the Groth16 pairing check.
        // Verifier takes no accounts; its entire input is the Borsh-serialized
        // SP1Groth16Proof in instruction_data.
        let proof_envelope = SP1Groth16Proof {
            proof,
            sp1_public_inputs: public_inputs,
        };
        let mut ix_data = Vec::with_capacity(8 + proof_envelope.proof.len() + proof_envelope.sp1_public_inputs.len());
        proof_envelope
            .serialize(&mut ix_data)
            .map_err(|_| ComplianceErr::ProofSerializationFailed)?;

        let verifier_ix = Instruction {
            program_id: ctx.accounts.verifier_program.key(),
            accounts: vec![],
            data: ix_data,
        };
        invoke(&verifier_ix, &[ctx.accounts.verifier_program.to_account_info()])
            .map_err(|_| ComplianceErr::VerificationFailed)?;

        // Proof verified — write the attestation.
        let clock = Clock::get()?;
        let att = &mut ctx.accounts.attestation;
        att.subject = ctx.accounts.subject.key();
        att.issuer = ctx.accounts.issuer.key();
        att.schema_id = schema_id;
        att.commitment = commitment;
        att.storage_uri = storage_uri;
        att.issued_at = clock.unix_timestamp;
        att.expires_at = expires_at;
        att.revoked_at = None;
        att.revocation_reason = None;
        att.version = 1;
        att.bump = ctx.bumps.attestation;
        att.verified = true;
        att.threshold = threshold;

        emit!(AttestationCreated {
            subject: att.subject,
            issuer: att.issuer,
            commitment: att.commitment,
            issued_at: att.issued_at,
            verified: true,
        });
        emit!(VerifiedAttestationCreated {
            subject: att.subject,
            issuer: att.issuer,
            commitment: att.commitment,
            threshold,
            verifier_program: ctx.accounts.verifier_program.key(),
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
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    #[max_len(64)]
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub bump: u8,
    /// True when created via `create_verified_attestation` (ZK-verified).
    pub verified: bool,
    /// Threshold from the proof's public values (0 when not verified).
    pub threshold: u32,
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
#[instruction(commitment: [u8; 32])]
pub struct CreateVerifiedAttestation<'info> {
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
    /// CHECK: address-constrained to the known dpo2u-compliance-verifier.
    #[account(address = verifier::ID)]
    pub verifier_program: AccountInfo<'info>,
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
    pub issued_at: i64,
    pub verified: bool,
}

#[event]
pub struct VerifiedAttestationCreated {
    pub subject: Pubkey,
    pub issuer: Pubkey,
    pub commitment: [u8; 32],
    pub threshold: u32,
    pub verifier_program: Pubkey,
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
    #[msg("proof bytes must be exactly 356 (SP1 v6 Groth16 layout)")]
    InvalidProofSize,
    #[msg("public_inputs must be 96 bytes (ABI-encoded PublicValuesStruct)")]
    InvalidPublicValuesSize,
    #[msg("could not parse PublicValuesStruct from public_inputs bytes")]
    MalformedPublicValues,
    #[msg("commitment argument does not match subject_commitment inside proof")]
    CommitmentMismatch,
    #[msg("proof's meets_threshold flag is false — subject does not meet policy")]
    ThresholdNotMet,
    #[msg("failed to Borsh-serialize SP1Groth16Proof for CPI")]
    ProofSerializationFailed,
    #[msg("CPI to dpo2u-compliance-verifier failed — proof did not verify")]
    VerificationFailed,
}
