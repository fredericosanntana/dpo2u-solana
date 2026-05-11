#![allow(deprecated, unexpected_cfgs)]

//! DPO2U PIPA Korea ZK Identity Registry — Korea PIPA Art. 24 + i-PIN context.
//!
//! Korean PIPA Art. 24 (Restrictions on Processing of Identification Numbers)
//! prohibits processing of Resident Registration Numbers (RRN) except in narrow
//! statutory cases. The Korean i-PIN system was created as a privacy-preserving
//! alternative; this program is its on-chain analogue.
//!
//! Privacy guarantees:
//!   1. NO identification number is stored on-chain. Only a `subject_commitment`
//!      (32 bytes — typically Poseidon or SHA-256 of identity_secret + salt).
//!   2. ZK proof verification via CPI to the same SP1 verifier used by
//!      compliance-registry + consent-manager (binding `subject_commitment`
//!      from `public_inputs[32..64]`).
//!   3. Attestor (the trusted issuer — e.g., a Korean Telco or NICE) can never
//!      attest a commitment for a different subject — proof binds them.
//!
//! Use cases:
//!   - Age gate (proof: "subject is over 19" without revealing DOB).
//!   - Identity verification for KYC (proof: "subject was identity-verified
//!      by attestor X" without revealing PII).
//!   - Cross-service identity (subject can prove to multiple services they are
//!      the same person without revealing any identifier).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};

declare_id!("41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR");

/// Shared SP1 v6 verifier — same address as compliance-registry / consent-manager.
pub mod verifier {
    use anchor_lang::prelude::*;
    declare_id!("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SP1Groth16Proof {
    pub proof: Vec<u8>,
    pub sp1_public_inputs: Vec<u8>,
}

/// Identity attribute kinds — narrowly enumerated to avoid scope creep.
pub const ATTR_AGE_GATE_19: u8 = 1;       // PIPA + Youth Protection Act
pub const ATTR_KOREAN_RESIDENT: u8 = 2;   // verified by RRN holder (attestor only)
pub const ATTR_KYC_VERIFIED: u8 = 3;      // KYC by FSC-licensed attestor
pub const ATTR_DOMESTIC_REPRESENTATIVE: u8 = 4; // PIPA Art. 31-2 — registered domestic rep

#[program]
pub mod pipa_korea_zk_identity {
    use super::*;

    /// Issue a ZK-bound identity attestation.
    ///
    /// `subject_commitment` is opaque to the program (Poseidon or SHA-256 of
    /// identity_secret + salt) — bound via SP1 proof's public_inputs[32..64].
    /// `attribute_kind` is one of the ATTR_* constants.
    /// `attribute_metadata_hash` is SHA-256 of off-chain claim metadata
    /// (issuance details, validity policies) — kept off-chain to honor PIPA
    /// data minimization (Art. 3 — minimum necessary).
    pub fn issue_attestation(
        ctx: Context<IssueAttestation>,
        subject_commitment: [u8; 32],
        attribute_kind: u8,
        attribute_metadata_hash: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
        expires_at: Option<i64>,
        storage_uri: String,
    ) -> Result<()> {
        require!(
            matches!(
                attribute_kind,
                ATTR_AGE_GATE_19 | ATTR_KOREAN_RESIDENT | ATTR_KYC_VERIFIED | ATTR_DOMESTIC_REPRESENTATIVE
            ),
            ZkIdErr::InvalidAttributeKind
        );
        require!(storage_uri.len() <= 128, ZkIdErr::StorageUriTooLong);
        require!(proof.len() == 356, ZkIdErr::InvalidProofSize);
        require!(public_inputs.len() == 96, ZkIdErr::InvalidPublicValuesSize);

        // ABI layout (matches compliance-registry + consent-manager):
        //   [0..32]  threshold (u32 BE in last 4 bytes)
        //   [32..64] subject_commitment
        //   [64..96] meets_threshold (in last byte)
        let threshold_bytes: [u8; 4] = public_inputs[28..32]
            .try_into()
            .map_err(|_| ZkIdErr::MalformedPublicValues)?;
        let threshold = u32::from_be_bytes(threshold_bytes);
        let decoded_commitment: [u8; 32] = public_inputs[32..64]
            .try_into()
            .map_err(|_| ZkIdErr::MalformedPublicValues)?;
        let meets_threshold = public_inputs[95] != 0;

        require!(
            subject_commitment == decoded_commitment,
            ZkIdErr::CommitmentMismatch
        );
        require!(meets_threshold, ZkIdErr::ThresholdNotMet);

        // CPI to SP1 verifier
        let proof_envelope = SP1Groth16Proof {
            proof,
            sp1_public_inputs: public_inputs,
        };
        let mut ix_data = Vec::with_capacity(
            8 + proof_envelope.proof.len() + proof_envelope.sp1_public_inputs.len(),
        );
        proof_envelope
            .serialize(&mut ix_data)
            .map_err(|_| ZkIdErr::ProofSerializationFailed)?;

        let verifier_ix = Instruction {
            program_id: ctx.accounts.verifier_program.key(),
            accounts: vec![],
            data: ix_data,
        };
        invoke(&verifier_ix, &[ctx.accounts.verifier_program.to_account_info()])
            .map_err(|_| ZkIdErr::VerificationFailed)?;

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.attestation;
        rec.attestor = ctx.accounts.attestor.key();
        rec.subject_commitment = subject_commitment;
        rec.attribute_kind = attribute_kind;
        rec.attribute_metadata_hash = attribute_metadata_hash;
        rec.threshold = threshold;
        rec.storage_uri = storage_uri;
        rec.issued_at = clock.unix_timestamp;
        rec.expires_at = expires_at;
        rec.revoked_at = None;
        rec.revocation_reason = None;
        rec.version = 1;
        rec.bump = ctx.bumps.attestation;

        emit!(AttestationIssued {
            attestor: rec.attestor,
            subject_commitment,
            attribute_kind,
            threshold,
            issued_at: rec.issued_at,
        });
        Ok(())
    }

    /// Revoke an attestation (issuer error, identity change, expiry override).
    /// Only the original attestor may revoke.
    pub fn revoke_attestation(
        ctx: Context<RevokeAttestation>,
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 64, ZkIdErr::ReasonTooLong);
        let rec = &mut ctx.accounts.attestation;
        require_keys_eq!(rec.attestor, ctx.accounts.attestor.key(), ZkIdErr::Unauthorized);
        require!(rec.revoked_at.is_none(), ZkIdErr::AlreadyRevoked);
        let clock = Clock::get()?;
        rec.revoked_at = Some(clock.unix_timestamp);
        rec.revocation_reason = Some(reason.clone());

        emit!(AttestationRevoked {
            attestor: rec.attestor,
            subject_commitment: rec.subject_commitment,
            attribute_kind: rec.attribute_kind,
            reason,
            revoked_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct ZkIdentityAttestation {
    pub attestor: Pubkey,
    pub subject_commitment: [u8; 32],
    pub attribute_kind: u8,
    pub attribute_metadata_hash: [u8; 32],
    pub threshold: u32,
    #[max_len(128)]
    pub storage_uri: String,
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    #[max_len(64)]
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(subject_commitment: [u8; 32], attribute_kind: u8)]
pub struct IssueAttestation<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        init,
        payer = attestor,
        space = 8 + ZkIdentityAttestation::INIT_SPACE,
        seeds = [
            b"pipa_zk_id",
            attestor.key().as_ref(),
            &subject_commitment,
            &[attribute_kind],
        ],
        bump
    )]
    pub attestation: Account<'info, ZkIdentityAttestation>,
    /// CHECK: address-constrained to the SP1 verifier program.
    #[account(address = verifier::ID)]
    pub verifier_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub attestor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"pipa_zk_id",
            attestation.attestor.as_ref(),
            &attestation.subject_commitment,
            &[attestation.attribute_kind],
        ],
        bump = attestation.bump
    )]
    pub attestation: Account<'info, ZkIdentityAttestation>,
}

// -- Events --

#[event]
pub struct AttestationIssued {
    pub attestor: Pubkey,
    pub subject_commitment: [u8; 32],
    pub attribute_kind: u8,
    pub threshold: u32,
    pub issued_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub attestor: Pubkey,
    pub subject_commitment: [u8; 32],
    pub attribute_kind: u8,
    pub reason: String,
    pub revoked_at: i64,
}

// -- Errors --

#[error_code]
pub enum ZkIdErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("revocation reason exceeds 64 bytes")]
    ReasonTooLong,
    #[msg("attribute_kind must be 1 (age gate), 2 (resident), 3 (KYC), or 4 (domestic rep)")]
    InvalidAttributeKind,
    #[msg("proof must be exactly 356 bytes (SP1 v6 Groth16 layout)")]
    InvalidProofSize,
    #[msg("public_inputs must be 96 bytes (PublicValuesStruct ABI)")]
    InvalidPublicValuesSize,
    #[msg("could not parse PublicValuesStruct from public_inputs bytes")]
    MalformedPublicValues,
    #[msg("subject_commitment argument does not match proof's public_inputs[32..64]")]
    CommitmentMismatch,
    #[msg("proof's meets_threshold flag is false — attestation does not satisfy policy")]
    ThresholdNotMet,
    #[msg("failed to Borsh-serialize SP1Groth16Proof for CPI")]
    ProofSerializationFailed,
    #[msg("CPI to SP1 verifier failed — proof did not verify")]
    VerificationFailed,
    #[msg("attestation already revoked")]
    AlreadyRevoked,
    #[msg("only the original attestor can revoke (PIPA Art. 24 chain of trust)")]
    Unauthorized,
}
