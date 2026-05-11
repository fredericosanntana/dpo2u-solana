#![allow(deprecated, unexpected_cfgs)]

//! DPO2U Hiroshima AI Process Attestation Registry
//!
//! Voluntary on-chain attestation of AI governance commitments aligned to:
//!  - **G7 Hiroshima AI Process — International Code of Conduct (ICOC)** —
//!    11 guiding principles, 60 countries Friends Group, reporting framework
//!    operational since Feb 2025.
//!  - **Japan AI Promotion Act (Act 53/2025)** + AI Basic Plan + Article 13
//!    Propriety Guidelines — first comprehensive G7 AI law, soft-law
//!    innovation-first.
//!  - **DS-920** (Digital Agency, May 2025) — Chief AI Officer (CAIO)
//!    mandate for all government agencies, full FY2026 application.
//!  - **AI Business Operator Guidelines v1.1** (METI+MIC, March 2025) —
//!    10 principles cross-ministerial.
//!  - **AISI** documents — CAIO Guidebook (March 2026), Data Quality v1.01,
//!    AI Safety Evaluation v1.10, Red Teaming v1.10.
//!
//! Design rationale:
//!  - **No ZK proof** — attestations are voluntary public commitments, not
//!    secrets. Use simple sha256 evidence_hash binding to off-chain bundle.
//!    Future v2 may add SP1 verifier for red-team confidentiality use cases.
//!  - **5 attestation types** — caio (1), red_team (2), icoc (3),
//!    data_quality (4), aibog (5). Each (attestor, ai_system_id, type)
//!    derives a unique PDA.
//!  - **Data minimization** — only evidence_hash + storage_uri on-chain;
//!    full evidence stays off-chain (IPFS / Arweave / corporate doc store).
//!  - **Soft-law caveat** — AI Promotion Act has no statutory penalties;
//!    attestation has symbolic/reputational weight, not enforce value.

use anchor_lang::prelude::*;

declare_id!("4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx");

/// Attestation type discriminators. Values are stable on-chain and used as
/// the 4th PDA seed component (`&[attestation_type]`).
pub const ATTEST_CAIO: u8 = 1;              // DS-920 Chief AI Officer appointment
pub const ATTEST_RED_TEAM: u8 = 2;          // AISI Red Teaming v1.10 evidence
pub const ATTEST_ICOC: u8 = 3;              // Hiroshima ICOC 11-principle commitment
pub const ATTEST_DATA_QUALITY: u8 = 4;      // AISI Data Quality v1.01 / AIST ML Quality v3
pub const ATTEST_AIBOG: u8 = 5;             // AI Business Operator Guidelines v1.1 alignment
// Sprint F (2026-05-06) — CAIDP UN Global Dialogue alignment
pub const ATTEST_RED_LINE_NEGATIVE: u8 = 6; // "Sistema NÃO usa categorias proibidas" — hash dos prohibitedUseFlags
pub const ATTEST_HRIA: u8 = 7;              // Human Rights Impact Assessment hash
pub const ATTEST_INCIDENT: u8 = 8;          // AI incident report hash (AIAAIC-aligned)

#[program]
pub mod hiroshima_ai_process_attestation {
    use super::*;

    /// Attest CAIO appointment per DS-920 mandate. `evidence_hash` should be
    /// SHA-256 of off-chain bundle: board resolution, CAIO charter, audit
    /// authority statement.
    pub fn attest_caio_appointment(
        ctx: Context<AttestCaio>,
        ai_system_id: [u8; 32],
        evidence_hash: [u8; 32],
        valid_until: Option<i64>,
        storage_uri: String,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, HiroErr::StorageUriTooLong);
        let clock = Clock::get()?;
        let r = &mut ctx.accounts.attestation;
        r.attestor = ctx.accounts.attestor.key();
        r.ai_system_id = ai_system_id;
        r.attestation_type = ATTEST_CAIO;
        r.evidence_hash = evidence_hash;
        r.valid_until = valid_until;
        r.revoked_at = None;
        r.storage_uri = storage_uri;
        r.issued_at = clock.unix_timestamp;
        r.version = 1;
        r.bump = ctx.bumps.attestation;
        emit!(CaioAttested {
            attestor: r.attestor,
            ai_system_id,
            issued_at: r.issued_at,
        });
        Ok(())
    }

    /// Submit red teaming evidence per AISI Red Teaming Guide v1.10.
    /// `evidence_hash` should bind to off-chain: red team report, attack
    /// vector coverage matrix (prompt injection / jailbreak / output safety
    /// / bias / privacy leakage / adversarial), team composition.
    pub fn submit_red_team_evidence(
        ctx: Context<SubmitRedTeam>,
        ai_system_id: [u8; 32],
        evidence_hash: [u8; 32],
        valid_until: Option<i64>,
        storage_uri: String,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, HiroErr::StorageUriTooLong);
        let clock = Clock::get()?;
        let r = &mut ctx.accounts.attestation;
        r.attestor = ctx.accounts.attestor.key();
        r.ai_system_id = ai_system_id;
        r.attestation_type = ATTEST_RED_TEAM;
        r.evidence_hash = evidence_hash;
        r.valid_until = valid_until;
        r.revoked_at = None;
        r.storage_uri = storage_uri;
        r.issued_at = clock.unix_timestamp;
        r.version = 1;
        r.bump = ctx.bumps.attestation;
        emit!(RedTeamEvidenceSubmitted {
            attestor: r.attestor,
            ai_system_id,
            issued_at: r.issued_at,
        });
        Ok(())
    }

    /// Commit to Hiroshima ICOC 11 guiding principles. This is the
    /// G7-aligned voluntary code (60 countries Friends Group). No statutory
    /// enforcement — symbolic/reputational only.
    pub fn commit_icoc_alignment(
        ctx: Context<CommitIcoc>,
        ai_system_id: [u8; 32],
        evidence_hash: [u8; 32],
        valid_until: Option<i64>,
        storage_uri: String,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, HiroErr::StorageUriTooLong);
        let clock = Clock::get()?;
        let r = &mut ctx.accounts.attestation;
        r.attestor = ctx.accounts.attestor.key();
        r.ai_system_id = ai_system_id;
        r.attestation_type = ATTEST_ICOC;
        r.evidence_hash = evidence_hash;
        r.valid_until = valid_until;
        r.revoked_at = None;
        r.storage_uri = storage_uri;
        r.issued_at = clock.unix_timestamp;
        r.version = 1;
        r.bump = ctx.bumps.attestation;
        emit!(IcocCommitted {
            attestor: r.attestor,
            ai_system_id,
            issued_at: r.issued_at,
        });
        Ok(())
    }

    /// Generic attestation for: data quality (4), AIBOG alignment (5),
    /// red-line-negative (6), HRIA hash (7), incident report (8).
    /// CAIO/red_team/ICOC have dedicated instructions.
    pub fn submit_generic_attestation(
        ctx: Context<SubmitGeneric>,
        ai_system_id: [u8; 32],
        attestation_type: u8,
        evidence_hash: [u8; 32],
        valid_until: Option<i64>,
        storage_uri: String,
    ) -> Result<()> {
        require!(
            attestation_type == ATTEST_DATA_QUALITY
                || attestation_type == ATTEST_AIBOG
                || attestation_type == ATTEST_RED_LINE_NEGATIVE
                || attestation_type == ATTEST_HRIA
                || attestation_type == ATTEST_INCIDENT,
            HiroErr::InvalidAttestationType
        );
        require!(storage_uri.len() <= 128, HiroErr::StorageUriTooLong);
        let clock = Clock::get()?;
        let r = &mut ctx.accounts.attestation;
        r.attestor = ctx.accounts.attestor.key();
        r.ai_system_id = ai_system_id;
        r.attestation_type = attestation_type;
        r.evidence_hash = evidence_hash;
        r.valid_until = valid_until;
        r.revoked_at = None;
        r.storage_uri = storage_uri;
        r.issued_at = clock.unix_timestamp;
        r.version = 1;
        r.bump = ctx.bumps.attestation;
        emit!(GenericAttestationSubmitted {
            attestor: r.attestor,
            ai_system_id,
            attestation_type,
            issued_at: r.issued_at,
        });
        Ok(())
    }

    /// Revoke any attestation type. Only the original attestor may revoke.
    /// Sprint F (2026-05-06): `is_termination_order=true` emits
    /// TerminationOrderEmitted (signals CAIDP UG Princípio 12 termination).
    pub fn revoke_attestation(
        ctx: Context<RevokeAttestation>,
        reason: String,
        is_termination_order: bool,
    ) -> Result<()> {
        require!(reason.len() <= 64, HiroErr::ReasonTooLong);
        let r = &mut ctx.accounts.attestation;
        require_keys_eq!(r.attestor, ctx.accounts.attestor.key(), HiroErr::Unauthorized);
        require!(r.revoked_at.is_none(), HiroErr::AlreadyRevoked);
        let clock = Clock::get()?;
        r.revoked_at = Some(clock.unix_timestamp);

        emit!(AttestationRevoked {
            attestor: r.attestor,
            ai_system_id: r.ai_system_id,
            attestation_type: r.attestation_type,
            reason: reason.clone(),
            revoked_at: clock.unix_timestamp,
        });
        if is_termination_order {
            emit!(TerminationOrderEmitted {
                ordered_by: r.attestor,
                ai_system_id: r.ai_system_id,
                trigger: TERM_TRIGGER_ATTESTATION_REVOCATION,
                reason,
                ordered_at: clock.unix_timestamp,
            });
        }
        Ok(())
    }

    // ─── Sprint F (2026-05-06) — Rapporteur authority + termination order ──

    /// Initialize program-wide RapporteurConfig singleton. The signer
    /// becomes both `admin` and the initial `rapporteur_authority`. Idempotent
    /// per program (init constraint enforces single PDA).
    pub fn initialize_rapporteur_config(
        ctx: Context<InitRapporteurConfig>,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.rapporteur_authority = ctx.accounts.admin.key();
        cfg.version = 1;
        cfg.bump = ctx.bumps.config;
        cfg.initialized_at = clock.unix_timestamp;
        emit!(RapporteurConfigInitialized {
            admin: cfg.admin,
            rapporteur_authority: cfg.rapporteur_authority,
            initialized_at: cfg.initialized_at,
        });
        Ok(())
    }

    /// Update the rapporteur authority. Only the current admin can call.
    /// Future: governance / DAO. Initial: DPO2U admin pubkey.
    pub fn update_rapporteur_authority(
        ctx: Context<UpdateRapporteurAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.admin, ctx.accounts.admin.key(), HiroErr::Unauthorized);
        let prev = cfg.rapporteur_authority;
        cfg.rapporteur_authority = new_authority;
        emit!(RapporteurAuthorityUpdated {
            admin: cfg.admin,
            previous_authority: prev,
            new_authority,
        });
        Ok(())
    }

    /// Issue an irreversible TerminationOrder for a given AI system. Only
    /// the configured rapporteur_authority can sign. Aligns with CAIDP
    /// rec #1 (UN Special Rapporteur on AI/HR) + rec #3 (red lines +
    /// termination obligation). Once issued, cannot be undone (init-once
    /// PDA per ai_system_id).
    pub fn flag_termination_obligation(
        ctx: Context<FlagTerminationObligation>,
        ai_system_id: [u8; 32],
        reason: String,
        evidence_hash: [u8; 32],
        red_line_category: u8,
    ) -> Result<()> {
        require!(reason.len() <= 128, HiroErr::ReasonTooLong);
        let cfg = &ctx.accounts.config;
        require_keys_eq!(
            cfg.rapporteur_authority,
            ctx.accounts.rapporteur.key(),
            HiroErr::Unauthorized
        );
        let clock = Clock::get()?;
        let order = &mut ctx.accounts.termination_order;
        order.ordered_by = ctx.accounts.rapporteur.key();
        order.ai_system_id = ai_system_id;
        order.reason = reason.clone();
        order.evidence_hash = evidence_hash;
        order.red_line_category = red_line_category;
        order.ordered_at = clock.unix_timestamp;
        order.version = 1;
        order.bump = ctx.bumps.termination_order;
        emit!(TerminationOrderEmitted {
            ordered_by: order.ordered_by,
            ai_system_id,
            trigger: TERM_TRIGGER_RAPPORTEUR_FLAG,
            reason,
            ordered_at: order.ordered_at,
        });
        Ok(())
    }
}

// -- Account state --

#[account]
#[derive(InitSpace)]
pub struct HiroshimaAttestation {
    pub attestor: Pubkey,                  // 32
    pub ai_system_id: [u8; 32],            // 32
    pub attestation_type: u8,              // 1
    pub evidence_hash: [u8; 32],           // 32 (SHA-256 of off-chain bundle)
    pub valid_until: Option<i64>,          // 9
    pub revoked_at: Option<i64>,           // 9
    #[max_len(128)]
    pub storage_uri: String,               // 4 + 128
    pub issued_at: i64,                    // 8
    pub version: u8,                       // 1
    pub bump: u8,                          // 1
}
// Discriminator(8) + InitSpace = 8 + (32+32+1+32+9+9+(4+128)+8+1+1) = 264 bytes

// Sprint F (2026-05-06) — Rapporteur authority singleton.
#[account]
#[derive(InitSpace)]
pub struct RapporteurConfig {
    pub admin: Pubkey,                 // 32
    pub rapporteur_authority: Pubkey,  // 32
    pub version: u8,                   // 1
    pub bump: u8,                      // 1
    pub initialized_at: i64,           // 8
}
// Discriminator(8) + InitSpace = 8 + 74 = 82 bytes

// Sprint F (2026-05-06) — Termination order (irreversible, init-once per ai_system_id).
#[account]
#[derive(InitSpace)]
pub struct TerminationOrder {
    pub ordered_by: Pubkey,            // 32 (rapporteur authority that issued)
    pub ai_system_id: [u8; 32],        // 32
    #[max_len(128)]
    pub reason: String,                // 4 + 128
    pub evidence_hash: [u8; 32],       // 32
    pub red_line_category: u8,         // 1 (CAIDP-UG canonical category index)
    pub ordered_at: i64,               // 8
    pub version: u8,                   // 1
    pub bump: u8,                      // 1
}
// Discriminator(8) + InitSpace = 8 + 239 = 247 bytes

/// Termination trigger discriminators (u8 instead of enum to avoid borsh
/// ambiguity in event derive). Stable on-chain.
pub const TERM_TRIGGER_ATTESTATION_REVOCATION: u8 = 1;
pub const TERM_TRIGGER_RAPPORTEUR_FLAG: u8 = 2;

// -- Account validation contexts --

#[derive(Accounts)]
#[instruction(ai_system_id: [u8; 32])]
pub struct AttestCaio<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        init,
        payer = attestor,
        space = 8 + HiroshimaAttestation::INIT_SPACE,
        seeds = [b"hiroshima_ai", attestor.key().as_ref(), &ai_system_id, &[ATTEST_CAIO]],
        bump
    )]
    pub attestation: Account<'info, HiroshimaAttestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ai_system_id: [u8; 32])]
pub struct SubmitRedTeam<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        init,
        payer = attestor,
        space = 8 + HiroshimaAttestation::INIT_SPACE,
        seeds = [b"hiroshima_ai", attestor.key().as_ref(), &ai_system_id, &[ATTEST_RED_TEAM]],
        bump
    )]
    pub attestation: Account<'info, HiroshimaAttestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ai_system_id: [u8; 32])]
pub struct CommitIcoc<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        init,
        payer = attestor,
        space = 8 + HiroshimaAttestation::INIT_SPACE,
        seeds = [b"hiroshima_ai", attestor.key().as_ref(), &ai_system_id, &[ATTEST_ICOC]],
        bump
    )]
    pub attestation: Account<'info, HiroshimaAttestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ai_system_id: [u8; 32], attestation_type: u8)]
pub struct SubmitGeneric<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,
    #[account(
        init,
        payer = attestor,
        space = 8 + HiroshimaAttestation::INIT_SPACE,
        seeds = [b"hiroshima_ai", attestor.key().as_ref(), &ai_system_id, &[attestation_type]],
        bump
    )]
    pub attestation: Account<'info, HiroshimaAttestation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub attestor: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"hiroshima_ai",
            attestation.attestor.as_ref(),
            &attestation.ai_system_id,
            &[attestation.attestation_type],
        ],
        bump = attestation.bump
    )]
    pub attestation: Account<'info, HiroshimaAttestation>,
}

// Sprint F (2026-05-06) — Rapporteur authority + Termination order contexts.

#[derive(Accounts)]
pub struct InitRapporteurConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + RapporteurConfig::INIT_SPACE,
        seeds = [b"rapporteur_config"],
        bump
    )]
    pub config: Account<'info, RapporteurConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRapporteurAuthority<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"rapporteur_config"],
        bump = config.bump
    )]
    pub config: Account<'info, RapporteurConfig>,
}

#[derive(Accounts)]
#[instruction(ai_system_id: [u8; 32])]
pub struct FlagTerminationObligation<'info> {
    #[account(mut)]
    pub rapporteur: Signer<'info>,
    #[account(
        seeds = [b"rapporteur_config"],
        bump = config.bump
    )]
    pub config: Account<'info, RapporteurConfig>,
    #[account(
        init,
        payer = rapporteur,
        space = 8 + TerminationOrder::INIT_SPACE,
        seeds = [b"termination_order".as_ref(), ai_system_id.as_ref()],
        bump
    )]
    pub termination_order: Account<'info, TerminationOrder>,
    pub system_program: Program<'info, System>,
}

// -- Events --

#[event]
pub struct CaioAttested {
    pub attestor: Pubkey,
    pub ai_system_id: [u8; 32],
    pub issued_at: i64,
}

#[event]
pub struct RedTeamEvidenceSubmitted {
    pub attestor: Pubkey,
    pub ai_system_id: [u8; 32],
    pub issued_at: i64,
}

#[event]
pub struct IcocCommitted {
    pub attestor: Pubkey,
    pub ai_system_id: [u8; 32],
    pub issued_at: i64,
}

#[event]
pub struct GenericAttestationSubmitted {
    pub attestor: Pubkey,
    pub ai_system_id: [u8; 32],
    pub attestation_type: u8,
    pub issued_at: i64,
}

#[event]
pub struct AttestationRevoked {
    pub attestor: Pubkey,
    pub ai_system_id: [u8; 32],
    pub attestation_type: u8,
    pub reason: String,
    pub revoked_at: i64,
}

// Sprint F (2026-05-06) events.
#[event]
pub struct RapporteurConfigInitialized {
    pub admin: Pubkey,
    pub rapporteur_authority: Pubkey,
    pub initialized_at: i64,
}

#[event]
pub struct RapporteurAuthorityUpdated {
    pub admin: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct TerminationOrderEmitted {
    pub ordered_by: Pubkey,
    pub ai_system_id: [u8; 32],
    pub trigger: u8, // 1=AttestationRevocation, 2=RapporteurFlag
    pub reason: String,
    pub ordered_at: i64,
}

// -- Errors --

#[error_code]
pub enum HiroErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("reason exceeds maximum length (revoke=64, terminate=128)")]
    ReasonTooLong,
    #[msg("attestation already revoked")]
    AlreadyRevoked,
    #[msg("only the original attestor / configured authority may perform this action")]
    Unauthorized,
    #[msg("attestation_type must be 4=DATA_QUALITY, 5=AIBOG, 6=RED_LINE_NEGATIVE, 7=HRIA, or 8=INCIDENT for generic submit")]
    InvalidAttestationType,
}
