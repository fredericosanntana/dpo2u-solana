// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions; bump to 0.32+ pending workspace migration.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U POPIA Information Officer Registry — South Africa POPIA §55.
//!
//! POPIA §55 mandates that every "Responsible Party" (controller) formally
//! appoint an Information Officer (IO) — analogous to the GDPR DPO. The IO is
//! responsible for conformance with the Act, dealing with data subject
//! requests, working with the Information Regulator, and developing/implementing
//! compliance frameworks.
//!
//! On-chain primitive: registry of IO appointments PDA-keyed by
//! (responsible_party, organization_id_hash). One active appointment per
//! organization at a time; historical record preserved via versioning.
//!
//! Use cases:
//!   - Verifiable proof of POPIA §55 compliance (third parties can read
//!     responsible_party PDA + see IO is appointed + appointed_at + active).
//!   - Audit trail: revoke + reappoint flows captured immutably.
//!   - Cross-jurisdiction interop: same primitive can be reused for similar
//!     officer-mandate regimes (NDPA §32 DPO, LAW25 §3.1 PIPA, PIPA Korea CPO).

use anchor_lang::prelude::*;

declare_id!("ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb");

#[program]
pub mod popia_info_officer_registry {
    use super::*;

    /// Register an Information Officer appointment.
    ///
    /// `organization_id_hash` is SHA-256 of an organization identifier (e.g.,
    /// CIPC company registration number for South African entities).
    /// `contact_hash` is SHA-256 of officer contact details (email/phone), kept
    /// off-chain for POPIA Condition 4 (Minimality) compliance.
    pub fn register_appointment(
        ctx: Context<RegisterAppointment>,
        organization_id_hash: [u8; 32],
        contact_hash: [u8; 32],
        storage_uri: String,
    ) -> Result<()> {
        require!(storage_uri.len() <= 128, IoErr::StorageUriTooLong);

        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.appointment;
        rec.responsible_party = ctx.accounts.responsible_party.key();
        rec.information_officer = ctx.accounts.information_officer.key();
        rec.organization_id_hash = organization_id_hash;
        rec.contact_hash = contact_hash;
        rec.storage_uri = storage_uri;
        rec.appointed_at = clock.unix_timestamp;
        rec.deputy = None;
        rec.revoked_at = None;
        rec.revocation_reason = None;
        rec.version = 1;
        rec.bump = ctx.bumps.appointment;

        emit!(AppointmentRegistered {
            responsible_party: rec.responsible_party,
            information_officer: rec.information_officer,
            organization_id_hash,
            appointed_at: rec.appointed_at,
        });
        Ok(())
    }

    /// Designate a Deputy Information Officer (POPIA §56).
    ///
    /// Only the responsible party may designate. Setting `deputy=None` removes
    /// any current deputy.
    pub fn set_deputy(ctx: Context<UpdateAppointment>, deputy: Option<Pubkey>) -> Result<()> {
        let rec = &mut ctx.accounts.appointment;
        require_keys_eq!(
            rec.responsible_party,
            ctx.accounts.responsible_party.key(),
            IoErr::Unauthorized
        );
        require!(rec.revoked_at.is_none(), IoErr::AppointmentRevoked);
        rec.deputy = deputy;

        emit!(DeputyUpdated {
            responsible_party: rec.responsible_party,
            information_officer: rec.information_officer,
            deputy,
        });
        Ok(())
    }

    /// Revoke an appointment (officer departure, restructure, etc.).
    /// Only the responsible party may revoke. PDA stays — re-registration uses
    /// new `organization_id_hash` or new responsible party.
    pub fn revoke_appointment(
        ctx: Context<UpdateAppointment>,
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 64, IoErr::ReasonTooLong);
        let clock = Clock::get()?;
        let rec = &mut ctx.accounts.appointment;
        require_keys_eq!(
            rec.responsible_party,
            ctx.accounts.responsible_party.key(),
            IoErr::Unauthorized
        );
        require!(rec.revoked_at.is_none(), IoErr::AlreadyRevoked);
        rec.revoked_at = Some(clock.unix_timestamp);
        rec.revocation_reason = Some(reason.clone());

        emit!(AppointmentRevoked {
            responsible_party: rec.responsible_party,
            information_officer: rec.information_officer,
            reason,
            revoked_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

// -- Accounts --

#[account]
#[derive(InitSpace)]
pub struct InfoOfficerAppointment {
    pub responsible_party: Pubkey,
    pub information_officer: Pubkey,
    pub organization_id_hash: [u8; 32],
    pub contact_hash: [u8; 32],
    #[max_len(128)]
    pub storage_uri: String,
    pub appointed_at: i64,
    pub deputy: Option<Pubkey>,
    pub revoked_at: Option<i64>,
    #[max_len(64)]
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(organization_id_hash: [u8; 32])]
pub struct RegisterAppointment<'info> {
    #[account(mut)]
    pub responsible_party: Signer<'info>,
    /// CHECK: information_officer pubkey is the formal appointee
    pub information_officer: AccountInfo<'info>,
    #[account(
        init,
        payer = responsible_party,
        space = 8 + InfoOfficerAppointment::INIT_SPACE,
        seeds = [
            b"popia_io",
            responsible_party.key().as_ref(),
            &organization_id_hash,
        ],
        bump
    )]
    pub appointment: Account<'info, InfoOfficerAppointment>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAppointment<'info> {
    pub responsible_party: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"popia_io",
            appointment.responsible_party.as_ref(),
            &appointment.organization_id_hash,
        ],
        bump = appointment.bump
    )]
    pub appointment: Account<'info, InfoOfficerAppointment>,
}

// -- Events --

#[event]
pub struct AppointmentRegistered {
    pub responsible_party: Pubkey,
    pub information_officer: Pubkey,
    pub organization_id_hash: [u8; 32],
    pub appointed_at: i64,
}

#[event]
pub struct DeputyUpdated {
    pub responsible_party: Pubkey,
    pub information_officer: Pubkey,
    pub deputy: Option<Pubkey>,
}

#[event]
pub struct AppointmentRevoked {
    pub responsible_party: Pubkey,
    pub information_officer: Pubkey,
    pub reason: String,
    pub revoked_at: i64,
}

// -- Errors --

#[error_code]
pub enum IoErr {
    #[msg("storage_uri exceeds 128 bytes")]
    StorageUriTooLong,
    #[msg("revocation reason exceeds 64 bytes")]
    ReasonTooLong,
    #[msg("appointment already revoked")]
    AlreadyRevoked,
    #[msg("only the responsible party can update or revoke (POPIA §55)")]
    Unauthorized,
    #[msg("appointment is revoked — cannot mutate further")]
    AppointmentRevoked,
}
