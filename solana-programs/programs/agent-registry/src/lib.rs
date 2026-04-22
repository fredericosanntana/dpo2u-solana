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
pub const ADMIN_PUBKEY: Pubkey = pubkey!("DPo2uAdM1n111111111111111111111111111111111");

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
        let clock = Clock::get()?;
        let agent = &mut ctx.accounts.agent;
        agent.permissions = new_permissions;
        agent.updated_at = clock.unix_timestamp;
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

#[error_code]
pub enum AgentErr {
    #[msg("name exceeds 32 bytes")]
    NameTooLong,
    #[msg("did_uri exceeds 128 bytes")]
    UriTooLong,
    #[msg("only the registered authority can modify")]
    Unauthorized,
    #[msg("only the global admin can update permissions")]
    UnauthorizedAdmin,
}
