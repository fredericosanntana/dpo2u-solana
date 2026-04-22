//! DPO2U AI Verify attestation — Singapore AI Verify "seal of trust" anchor.
//!
//! Off-chain:
//!   1. aiverify-test-engine (Python) runs fairness/robustness tests on a
//!      DPO-controlled ML model.
//!   2. Test runner hashes the model weights (sha256 → model_hash) and the
//!      report.json (sha256 → test_report_hash).
//!   3. The verifying key root (vk_root) identifies the test pipeline
//!      version that produced the report.
//!
//! On-chain:
//!   `attest_model` stores these 3 hashes + timestamp + operator in a PDA
//!   seeded by [b"aiverify", model_hash]. Any user can verify the
//!   attestation by re-hashing the model and reading the PDA.
//!
//! Deliberately minimal — no ZK CPI, no verifier. AI Verify's toolkit runs
//! off-chain; this program is the public notarization layer.

use anchor_lang::prelude::*;

declare_id!("DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm");

#[program]
pub mod aiverify_attestation {
    use super::*;

    pub fn attest_model(
        ctx: Context<AttestModel>,
        model_hash: [u8; 32],
        test_report_hash: [u8; 32],
        vk_root: [u8; 32],
        framework_code: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let a = &mut ctx.accounts.attestation;
        a.operator = ctx.accounts.operator.key();
        a.model_hash = model_hash;
        a.test_report_hash = test_report_hash;
        a.vk_root = vk_root;
        a.framework_code = framework_code;
        a.attested_at = clock.unix_timestamp;
        a.revoked_at = None;
        a.version = 1;
        a.bump = ctx.bumps.attestation;

        emit!(ModelAttested {
            operator: a.operator,
            model_hash,
            test_report_hash,
            vk_root,
            framework_code,
            attested_at: a.attested_at,
        });
        Ok(())
    }

    /// Optional: revoke an attestation (e.g., model found to have regressed).
    /// Only the original operator may revoke.
    pub fn revoke_attestation(ctx: Context<RevokeAttestation>, reason_code: u16) -> Result<()> {
        let a = &mut ctx.accounts.attestation;
        require_keys_eq!(a.operator, ctx.accounts.operator.key(), AiVerifyErr::Unauthorized);
        require!(a.revoked_at.is_none(), AiVerifyErr::AlreadyRevoked);
        a.revoked_at = Some(Clock::get()?.unix_timestamp);
        a.reason_code = reason_code;
        emit!(AttestationRevoked {
            operator: a.operator,
            model_hash: a.model_hash,
            reason_code,
            revoked_at: a.revoked_at.unwrap(),
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct ModelAttestation {
    pub operator: Pubkey,
    pub model_hash: [u8; 32],
    pub test_report_hash: [u8; 32],
    pub vk_root: [u8; 32],
    /// Framework code: 0=AI Verify (Singapore), 1=EU AI Act conformity, 2=ISO/IEC 42001, etc.
    pub framework_code: u16,
    pub attested_at: i64,
    pub revoked_at: Option<i64>,
    pub reason_code: u16,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(model_hash: [u8; 32])]
pub struct AttestModel<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        init,
        payer = operator,
        space = 8 + ModelAttestation::INIT_SPACE,
        seeds = [b"aiverify".as_ref(), model_hash.as_ref()],
        bump
    )]
    pub attestation: Account<'info, ModelAttestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub operator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"aiverify".as_ref(), attestation.model_hash.as_ref()],
        bump = attestation.bump
    )]
    pub attestation: Account<'info, ModelAttestation>,
}

// -- Events --

#[event]
pub struct ModelAttested {
    pub operator: Pubkey,
    pub model_hash: [u8; 32],
    pub test_report_hash: [u8; 32],
    pub vk_root: [u8; 32],
    pub framework_code: u16,
    pub attested_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub operator: Pubkey,
    pub model_hash: [u8; 32],
    pub reason_code: u16,
    pub revoked_at: i64,
}

// -- Errors --

#[error_code]
pub enum AiVerifyErr {
    #[msg("only the original operator may revoke this attestation")]
    Unauthorized,
    #[msg("attestation already revoked")]
    AlreadyRevoked,
}
