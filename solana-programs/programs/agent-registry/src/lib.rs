// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions (custom-heap, solana, etc.); bump to 0.32+
// scheduled for post-Colosseum.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U Agent Registry
//!
//! Records DIDs of autonomous compliance agents (DPO bots, auditors, monitors)
//! on-chain. Agent = (authority_pubkey, name) → DID commitment + capability
//! bitmask. Enables permissioned callers (PaymentGateway / ComplianceRegistry)
//! to assert an agent's role before settling or attesting.

use anchor_lang::prelude::*;

declare_id!("5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7");

// Permission bits (match the off-chain DPO2U agent model: see 00-META docs)
pub const PERM_READ: u16 = 1;
pub const PERM_WRITE: u16 = 2;
pub const PERM_TREASURY: u16 = 4;
pub const PERM_DEPLOY: u16 = 8;
pub const PERM_GOVERNANCE: u16 = 16;

use anchor_lang::solana_program::pubkey;
// Devnet governance authority — rotate to a multisig before any mainnet deploy.
pub const ADMIN_PUBKEY: Pubkey = pubkey!("HjpGXPWQF1PiqjdWtNNEbAxqNamXKGpJspRZm9Jv5LZj");

#[program]
pub mod agent_registry {
    use super::*;

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        did_commitment: [u8; 32],
        did_uri: String,
        _permissions: u16,
    ) -> Result<()> {
        // Auditor F-004 fix (2026-05-11): empty name produces hard-to-index
        // and PDA-distinguishable-by-prefix-only agents. Require at least 1 byte.
        require!(!name.is_empty(), AgentErr::NameEmpty);
        require!(name.len() <= 32, AgentErr::NameTooLong);
        require!(did_uri.len() <= 128, AgentErr::UriTooLong);

        let clock = Clock::get()?;
        let agent = &mut ctx.accounts.agent;
        agent.authority = ctx.accounts.authority.key();
        agent.name = name;
        agent.did_commitment = did_commitment;
        agent.did_uri = did_uri;
        agent.permissions = PERM_READ; // Always default to basic permissions
        agent.created_at = clock.unix_timestamp;
        agent.updated_at = clock.unix_timestamp;
        agent.bump = ctx.bumps.agent;

        emit!(AgentRegistered {
            authority: agent.authority,
            name: agent.name.clone(),
            permissions: agent.permissions,
        });
        Ok(())
    }

    pub fn update_permissions(ctx: Context<AdminUpdateAgent>, new_permissions: u16) -> Result<()> {
        // Auditor F-002 fix (2026-05-11): only canonical PERM_* bits accepted.
        // Bits 5-15 are undefined — rejecting them prevents privilege smuggling
        // through unknown bits that future consumers may interpret unsafely.
        const VALID_PERMS_MASK: u16 =
            PERM_READ | PERM_WRITE | PERM_TREASURY | PERM_DEPLOY | PERM_GOVERNANCE;
        require!(
            new_permissions & !VALID_PERMS_MASK == 0,
            AgentErr::InvalidPermissions
        );
        let clock = Clock::get()?;
        let agent = &mut ctx.accounts.agent;
        agent.permissions = new_permissions;
        agent.updated_at = clock.unix_timestamp;
        Ok(())
    }

    /// Auditor F-005 fix (2026-05-11): close an agent account and reclaim rent
    /// to authority. Only callable by the agent's authority. Permanent.
    pub fn close_agent(ctx: Context<CloseAgent>) -> Result<()> {
        let agent = &ctx.accounts.agent;
        require_keys_eq!(agent.authority, ctx.accounts.authority.key(), AgentErr::Unauthorized);
        emit!(AgentClosed {
            authority: agent.authority,
            name: agent.name.clone(),
        });
        Ok(())
    }

    pub fn revoke_agent(ctx: Context<UpdateAgent>) -> Result<()> {
        let clock = Clock::get()?;
        let agent = &mut ctx.accounts.agent;
        require_keys_eq!(agent.authority, ctx.accounts.authority.key(), AgentErr::Unauthorized);
        agent.permissions = 0;
        agent.updated_at = clock.unix_timestamp;

        emit!(AgentRevoked {
            authority: agent.authority,
            name: agent.name.clone(),
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub did_commitment: [u8; 32],
    #[max_len(128)]
    pub did_uri: String,
    pub permissions: u16,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", authority.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminUpdateAgent<'info> {
    #[account(mut, address = ADMIN_PUBKEY @ AgentErr::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"agent", agent.authority.as_ref(), agent.name.as_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"agent", agent.authority.as_ref(), agent.name.as_bytes()], bump = agent.bump)]
    pub agent: Account<'info, Agent>,
}

#[derive(Accounts)]
pub struct CloseAgent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        close = authority,
        seeds = [b"agent", agent.authority.as_ref(), agent.name.as_bytes()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
}

#[event]
pub struct AgentRegistered {
    pub authority: Pubkey,
    pub name: String,
    pub permissions: u16,
}

#[event]
pub struct AgentRevoked {
    pub authority: Pubkey,
    pub name: String,
}

#[event]
pub struct AgentClosed {
    pub authority: Pubkey,
    pub name: String,
}

#[error_code]
pub enum AgentErr {
    #[msg("name must be 1..=32 bytes")]
    NameTooLong,
    #[msg("name must not be empty")]
    NameEmpty,
    #[msg("did_uri exceeds 128 bytes")]
    UriTooLong,
    #[msg("only the registered authority can modify")]
    Unauthorized,
    #[msg("only the global admin can update permissions")]
    UnauthorizedAdmin,
    #[msg("permissions bitmap contains undefined bits (only PERM_READ|WRITE|TREASURY|DEPLOY|GOVERNANCE allowed)")]
    InvalidPermissions,
}
