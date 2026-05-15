// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions; bump to 0.32+ pending workspace migration.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U Legal Source Manifest — on-chain pointer to the off-chain legal corpus.
//!
//! Companion program for the `dpo2u-legal-worker` container that wraps
//! `worldwidelaw/legal-sources`. Each jurisdiction the worker syncs (LGPD, GDPR,
//! MICAR, APPI, ...) produces a `manifest.json` with an `aggregate_hash`
//! (sha256 of sorted per-source content hashes). This program publishes that
//! hash on-chain so attestations from sibling DPO2U programs (popia, ccpa,
//! pipeda, hiroshima, ...) can pin "this attestation was evaluated against
//! jurisdiction X legal corpus version V" with tamper-evident proof.
//!
//! Design:
//!   - One PDA per jurisdiction, seeded by `[b"legal_manifest", jurisdiction]`.
//!   - `manifest_version` is a monotonic counter bumped on every update.
//!   - Identity-update detection: re-submitting the same `content_hash` is a
//!     no-op (returns `ContentHashUnchanged`) so the on-chain history doesn't
//!     get polluted by idempotent worker re-runs.
//!   - Authority can be transferred (e.g. multisig migration) but only by the
//!     current authority.

use anchor_lang::prelude::*;

declare_id!("eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK");

/// Fixed-width jurisdiction code so PDA seed length is deterministic.
/// ASCII, NUL-padded: e.g. "LGPD\0\0\0\0\0\0\0\0\0\0\0\0", "MICAR\0\0\0...".
pub const JURISDICTION_BYTES: usize = 16;

#[program]
pub mod legal_source_manifest {
    use super::*;

    /// First-time publication of a jurisdiction's manifest.
    ///
    /// `jurisdiction`    — fixed-width ASCII code (NUL-padded to 16 bytes)
    /// `content_hash`    — sha256 of the worker's aggregate hash string
    /// `effective_date`  — unix ts of the underlying legal corpus version
    /// `source_uri_len`  — length of the off-chain pointer string (URL/IPFS)
    pub fn init_manifest(
        ctx: Context<InitManifest>,
        jurisdiction: [u8; JURISDICTION_BYTES],
        content_hash: [u8; 32],
        effective_date: i64,
        source_uri: String,
    ) -> Result<()> {
        require!(source_uri.len() <= 256, LegalManifestErr::SourceUriTooLong);
        require!(effective_date > 0, LegalManifestErr::InvalidEffectiveDate);

        let clock = Clock::get()?;
        let m = &mut ctx.accounts.manifest;
        m.jurisdiction = jurisdiction;
        m.content_hash = content_hash;
        m.manifest_version = 1;
        m.effective_date = effective_date;
        m.last_sync = clock.unix_timestamp;
        m.source_uri = source_uri;
        m.authority = ctx.accounts.authority.key();
        m.bump = ctx.bumps.manifest;

        emit!(ManifestInitialized {
            jurisdiction,
            content_hash,
            effective_date,
            authority: m.authority,
            initialized_at: m.last_sync,
        });
        Ok(())
    }

    /// Publish a new corpus version. Bumps `manifest_version`. Reverts if the
    /// hash didn't change (worker idempotent re-run).
    pub fn update_manifest(
        ctx: Context<UpdateManifest>,
        content_hash: [u8; 32],
        effective_date: i64,
        source_uri: String,
    ) -> Result<()> {
        require!(source_uri.len() <= 256, LegalManifestErr::SourceUriTooLong);
        require!(effective_date > 0, LegalManifestErr::InvalidEffectiveDate);

        let m = &mut ctx.accounts.manifest;
        require_keys_eq!(
            m.authority,
            ctx.accounts.authority.key(),
            LegalManifestErr::UnauthorizedAuthority
        );
        require!(
            m.content_hash != content_hash,
            LegalManifestErr::ContentHashUnchanged
        );

        let prev_version = m.manifest_version;
        let clock = Clock::get()?;
        m.content_hash = content_hash;
        m.manifest_version = m.manifest_version.checked_add(1).unwrap_or(m.manifest_version);
        m.effective_date = effective_date;
        m.last_sync = clock.unix_timestamp;
        m.source_uri = source_uri;

        emit!(ManifestUpdated {
            jurisdiction: m.jurisdiction,
            prev_version,
            new_version: m.manifest_version,
            content_hash,
            effective_date,
            updated_at: m.last_sync,
        });
        Ok(())
    }

    /// Transfer authority to a new key (e.g. Squads multisig).
    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let m = &mut ctx.accounts.manifest;
        require_keys_eq!(
            m.authority,
            ctx.accounts.authority.key(),
            LegalManifestErr::UnauthorizedAuthority
        );
        let prev_authority = m.authority;
        m.authority = new_authority;

        emit!(AuthorityTransferred {
            jurisdiction: m.jurisdiction,
            prev_authority,
            new_authority,
            transferred_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct LegalSourceManifestAccount {
    pub jurisdiction: [u8; JURISDICTION_BYTES],
    pub content_hash: [u8; 32],
    pub manifest_version: u32,
    pub effective_date: i64,
    pub last_sync: i64,
    #[max_len(256)]
    pub source_uri: String,
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(jurisdiction: [u8; JURISDICTION_BYTES])]
pub struct InitManifest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + LegalSourceManifestAccount::INIT_SPACE,
        seeds = [b"legal_manifest".as_ref(), &jurisdiction],
        bump
    )]
    pub manifest: Account<'info, LegalSourceManifestAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateManifest<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"legal_manifest".as_ref(), &manifest.jurisdiction],
        bump = manifest.bump
    )]
    pub manifest: Account<'info, LegalSourceManifestAccount>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"legal_manifest".as_ref(), &manifest.jurisdiction],
        bump = manifest.bump
    )]
    pub manifest: Account<'info, LegalSourceManifestAccount>,
}

// -- Events --

#[event]
pub struct ManifestInitialized {
    pub jurisdiction: [u8; JURISDICTION_BYTES],
    pub content_hash: [u8; 32],
    pub effective_date: i64,
    pub authority: Pubkey,
    pub initialized_at: i64,
}

#[event]
pub struct ManifestUpdated {
    pub jurisdiction: [u8; JURISDICTION_BYTES],
    pub prev_version: u32,
    pub new_version: u32,
    pub content_hash: [u8; 32],
    pub effective_date: i64,
    pub updated_at: i64,
}

#[event]
pub struct AuthorityTransferred {
    pub jurisdiction: [u8; JURISDICTION_BYTES],
    pub prev_authority: Pubkey,
    pub new_authority: Pubkey,
    pub transferred_at: i64,
}

// -- Errors --

#[error_code]
pub enum LegalManifestErr {
    #[msg("source_uri exceeds the 256-byte ceiling")]
    SourceUriTooLong,
    #[msg("effective_date must be > 0 (unix timestamp)")]
    InvalidEffectiveDate,
    #[msg("signer is not the current manifest authority")]
    UnauthorizedAuthority,
    #[msg("identity update: content_hash unchanged — refusing no-op")]
    ContentHashUnchanged,
}
