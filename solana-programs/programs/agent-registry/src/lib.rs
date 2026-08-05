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

    /// Register an MCP server in the on-chain whitelist (IMDA MGF-Agentic p.19
    /// "MCP whitelist" pattern). The MCP pubkey is the canonical identifier
    /// the deploying organisation references in its tool-gating runtime
    /// control. Jurisdictions list (max 8) tags which regimes this MCP server
    /// was audited against. Added 2026-05-15 (Sprint Continuable round 2).
    pub fn register_mcp_server(
        ctx: Context<RegisterMcpServer>,
        mcp_pubkey: Pubkey,
        name: String,
        compliance_hash: [u8; 32],
        jurisdictions_supported: Vec<[u8; 16]>,
        audit_date: i64,
        audit_uri: String,
    ) -> Result<()> {
        require!(!name.is_empty() && name.len() <= 48, AgentErr::NameTooLong);
        require!(audit_uri.len() <= 128, AgentErr::UriTooLong);
        require!(
            jurisdictions_supported.len() <= 8,
            AgentErr::TooManyJurisdictions
        );
        let clock = Clock::get()?;
        let mcp = &mut ctx.accounts.mcp_server;
        mcp.authority = ctx.accounts.authority.key();
        mcp.mcp_pubkey = mcp_pubkey;
        mcp.name = name.clone();
        mcp.compliance_hash = compliance_hash;
        mcp.jurisdictions_supported = jurisdictions_supported.clone();
        mcp.audit_date = audit_date;
        mcp.audit_uri = audit_uri;
        mcp.registered_at = clock.unix_timestamp;
        mcp.revoked_at = None;
        mcp.bump = ctx.bumps.mcp_server;
        emit!(McpServerRegistered {
            authority: mcp.authority,
            mcp_pubkey,
            name,
            compliance_hash,
            jurisdictions_count: jurisdictions_supported.len() as u8,
            audit_date,
        });
        Ok(())
    }

    /// Revoke an MCP server whitelist entry (e.g. audit expired or compliance
    /// hash regressed). Only the original authority may revoke.
    pub fn revoke_mcp_server(ctx: Context<RevokeMcpServer>, reason_code: u16) -> Result<()> {
        let mcp = &mut ctx.accounts.mcp_server;
        require_keys_eq!(mcp.authority, ctx.accounts.authority.key(), AgentErr::Unauthorized);
        require!(mcp.revoked_at.is_none(), AgentErr::AlreadyRevoked);
        mcp.revoked_at = Some(Clock::get()?.unix_timestamp);
        emit!(McpServerRevoked {
            mcp_pubkey: mcp.mcp_pubkey,
            reason_code,
            revoked_at: mcp.revoked_at.unwrap(),
        });
        Ok(())
    }

    /// Register a node in the agentic-economy 5-actor value chain
    /// (Model Developer → Tool Provider → Agentic Provider → Deploying
    /// Organisation → End User — MGF-Agentic + Kenney "Governing Agents"
    /// canonical taxonomy). Each node is per (authority, agent_id) and
    /// optionally references its parent node PDA, building a DAG of
    /// responsibility that auditors can traverse.
    /// Added 2026-05-15 (Sprint Continuable round 2).
    pub fn register_value_chain_node(
        ctx: Context<RegisterValueChainNode>,
        agent_id: [u8; 32],
        role: u8,
        parent: Option<Pubkey>,
        jurisdiction: [u8; 16],
        contract_uri: String,
    ) -> Result<()> {
        // role: 1=ModelDev 2=ToolProvider 3=AgenticProvider 4=DeployingOrg 5=EndUser
        require!(role >= 1 && role <= 5, AgentErr::InvalidRole);
        require!(contract_uri.len() <= 128, AgentErr::UriTooLong);
        let clock = Clock::get()?;
        let node = &mut ctx.accounts.node;
        node.authority = ctx.accounts.authority.key();
        node.agent_id = agent_id;
        node.role = role;
        node.parent = parent;
        node.jurisdiction = jurisdiction;
        node.contract_uri = contract_uri;
        node.attested_at = clock.unix_timestamp;
        node.bump = ctx.bumps.node;
        emit!(ValueChainNodeRegistered {
            authority: node.authority,
            agent_id,
            role,
            parent,
            jurisdiction,
            attested_at: node.attested_at,
        });
        Ok(())
    }

    /// Cross-program attestation against ANY legal_source_manifest PDA.
    /// Agent-registry is ERC-8004 / MGF-Agentic cross-framework — accepts any
    /// jurisdiction. Use for anchoring an agent identity against the specific
    /// regulatory regime its deployment falls under.
    /// Added 2026-05-15 (Sprint Continuable).
    pub fn verify_against_legal_manifest(
        ctx: Context<VerifyAgainstLegalManifest>,
    ) -> Result<()> {
        let m = &ctx.accounts.legal_manifest;
        let nul = m.jurisdiction.iter().position(|&b| b == 0).unwrap_or(m.jurisdiction.len());
        let mut juris_buf = [0u8; 16];
        juris_buf[..nul].copy_from_slice(&m.jurisdiction[..nul]);
        let agent = &ctx.accounts.agent;
        emit!(AgentVerifiedAgainstManifest {
            authority: agent.authority,
            name: agent.name.clone(),
            jurisdiction: juris_buf,
            manifest_version: m.manifest_version,
            content_hash: m.content_hash,
            effective_date: m.effective_date,
            verified_at: Clock::get()?.unix_timestamp,
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

// -- MCP Whitelist accounts (Sprint Continuable round 2 2026-05-15) --

#[account]
#[derive(InitSpace)]
pub struct McpServer {
    pub authority: Pubkey,
    pub mcp_pubkey: Pubkey,
    #[max_len(48)]
    pub name: String,
    pub compliance_hash: [u8; 32],
    #[max_len(8)]
    pub jurisdictions_supported: Vec<[u8; 16]>,
    pub audit_date: i64,
    #[max_len(128)]
    pub audit_uri: String,
    pub registered_at: i64,
    pub revoked_at: Option<i64>,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(mcp_pubkey: Pubkey)]
pub struct RegisterMcpServer<'info> {
    // Audit SOL-H003 fix (2026-05-15): only ADMIN_PUBKEY can publish MCP
    // whitelist entries. Permissionless registration allowed anyone to forge
    // IMDA MGF-Agentic-aligned MCP attestations. The whitelist is a curated
    // allowlist by design; off-chain consumers should still verify the
    // authority field on read.
    #[account(mut, address = ADMIN_PUBKEY @ AgentErr::UnauthorizedAdmin)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + McpServer::INIT_SPACE,
        seeds = [b"mcp_server", authority.key().as_ref(), mcp_pubkey.as_ref()],
        bump
    )]
    pub mcp_server: Account<'info, McpServer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeMcpServer<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mcp_server", mcp_server.authority.as_ref(), mcp_server.mcp_pubkey.as_ref()],
        bump = mcp_server.bump,
    )]
    pub mcp_server: Account<'info, McpServer>,
}

// -- Value Chain Node accounts (5-actor MGF-Agentic + Kenney taxonomy) --

#[account]
#[derive(InitSpace)]
pub struct ValueChainNode {
    pub authority: Pubkey,
    pub agent_id: [u8; 32],
    pub role: u8,
    pub parent: Option<Pubkey>,
    pub jurisdiction: [u8; 16],
    #[max_len(128)]
    pub contract_uri: String,
    pub attested_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(agent_id: [u8; 32], role: u8)]
pub struct RegisterValueChainNode<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ValueChainNode::INIT_SPACE,
        seeds = [b"value_chain", authority.key().as_ref(), agent_id.as_ref(), &[role]],
        bump
    )]
    pub node: Account<'info, ValueChainNode>,
    pub system_program: Program<'info, System>,
}

/// Cross-program verification accounts (Sprint Continuable 2026-05-15).
#[derive(Accounts)]
pub struct VerifyAgainstLegalManifest<'info> {
    #[account(
        seeds = [b"agent", agent.authority.as_ref(), agent.name.as_bytes()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        seeds = [b"legal_manifest".as_ref(), &legal_manifest.jurisdiction],
        bump = legal_manifest.bump,
        seeds::program = legal_source_manifest::ID,
    )]
    pub legal_manifest: Account<'info, legal_source_manifest::LegalSourceManifestAccount>,
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

#[event]
pub struct McpServerRegistered {
    pub authority: Pubkey,
    pub mcp_pubkey: Pubkey,
    pub name: String,
    pub compliance_hash: [u8; 32],
    pub jurisdictions_count: u8,
    pub audit_date: i64,
}

#[event]
pub struct McpServerRevoked {
    pub mcp_pubkey: Pubkey,
    pub reason_code: u16,
    pub revoked_at: i64,
}

#[event]
pub struct ValueChainNodeRegistered {
    pub authority: Pubkey,
    pub agent_id: [u8; 32],
    pub role: u8,
    pub parent: Option<Pubkey>,
    pub jurisdiction: [u8; 16],
    pub attested_at: i64,
}

#[event]
pub struct AgentVerifiedAgainstManifest {
    pub authority: Pubkey,
    pub name: String,
    pub jurisdiction: [u8; 16],
    pub manifest_version: u32,
    pub content_hash: [u8; 32],
    pub effective_date: i64,
    pub verified_at: i64,
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
    #[msg("jurisdictions_supported list exceeds 8 entries")]
    TooManyJurisdictions,
    #[msg("role must be 1..=5 (1=ModelDev 2=ToolProvider 3=AgenticProvider 4=DeployingOrg 5=EndUser)")]
    InvalidRole,
    #[msg("already revoked")]
    AlreadyRevoked,
}
