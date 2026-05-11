// anchor-lang 0.31.1 #[program] macro expands to deprecated AccountInfo::realloc
// and emits unknown cfg conditions (custom-heap, solana, etc.); bump to 0.32+
// scheduled for post-Colosseum.
#![allow(deprecated, unexpected_cfgs)]

//! DPO2U Agent Wallet Factory
//!
//! Creates a PDA-owned "wallet" account for each agent deterministically derived
//! from a seed bytestring. The wallet itself is a program-signed account that
//! can hold SOL; SPL Token associated accounts come next (Sprint 4 CPI).
//!
//! Design note: deliberately simpler than Squads v4 multi-sig — agents are
//! automated, not human-signed. Sprint 6 can add Squads integration for agents
//! that need multi-party authorization.

use anchor_lang::prelude::*;

declare_id!("AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in");

#[program]
pub mod agent_wallet_factory {
    use super::*;

    pub fn create_agent_wallet(
        ctx: Context<CreateAgentWallet>,
        agent_seed: [u8; 32],
        label: String,
    ) -> Result<()> {
        require!(label.len() <= 32, WalletErr::LabelTooLong);

        let clock = Clock::get()?;
        let wallet = &mut ctx.accounts.wallet;
        wallet.creator = ctx.accounts.creator.key();
        wallet.agent_seed = agent_seed;
        wallet.label = label;
        wallet.created_at = clock.unix_timestamp;
        wallet.bump = ctx.bumps.wallet;

        emit!(WalletCreated {
            creator: wallet.creator,
            agent_seed,
            label: wallet.label.clone(),
            wallet_pubkey: ctx.accounts.wallet.key(),
        });
        Ok(())
    }

    /// Transfer SOL from wallet PDA (signed by program).
    ///
    /// Auditor F-001 fix (2026-05-11): respects rent-exempt minimum so wallet
    /// state can't be drained → reclaim → re-init with attacker creator.
    pub fn wallet_transfer(ctx: Context<WalletTransfer>, lamports: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.wallet.creator, ctx.accounts.creator.key(), WalletErr::Unauthorized);

        let from = ctx.accounts.wallet.to_account_info();
        let to = ctx.accounts.destination.to_account_info();

        // Reserve rent-exempt minimum — never let wallet drop below it.
        let rent_min = Rent::get()?.minimum_balance(from.data_len());
        let available = from
            .lamports()
            .checked_sub(rent_min)
            .ok_or(WalletErr::InsufficientFunds)?;
        require!(lamports <= available, WalletErr::InsufficientFunds);

        **from.try_borrow_mut_lamports()? = from
            .lamports()
            .checked_sub(lamports)
            .ok_or(WalletErr::InsufficientFunds)?;
        **to.try_borrow_mut_lamports()? = to
            .lamports()
            .checked_add(lamports)
            .ok_or(WalletErr::MathOverflow)?;

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct AgentWallet {
    pub creator: Pubkey,
    pub agent_seed: [u8; 32],
    #[max_len(32)]
    pub label: String,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(agent_seed: [u8; 32])]
pub struct CreateAgentWallet<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// Auditor F-002 fix (2026-05-11): creator now in seed so wallets cannot
    /// be front-run by anyone observing public agent_seeds (DIDs).
    /// BREAKING: PDA addresses differ from pre-fix versions.
    #[account(
        init,
        payer = creator,
        space = 8 + AgentWallet::INIT_SPACE,
        seeds = [b"agent_wallet".as_ref(), creator.key().as_ref(), agent_seed.as_ref()],
        bump
    )]
    pub wallet: Account<'info, AgentWallet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WalletTransfer<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [b"agent_wallet".as_ref(), wallet.creator.as_ref(), wallet.agent_seed.as_ref()],
        bump = wallet.bump
    )]
    pub wallet: Account<'info, AgentWallet>,
    /// CHECK: destination is any account receiving SOL
    #[account(mut)]
    pub destination: AccountInfo<'info>,
}

#[event]
pub struct WalletCreated {
    pub creator: Pubkey,
    pub agent_seed: [u8; 32],
    pub label: String,
    pub wallet_pubkey: Pubkey,
}

#[error_code]
pub enum WalletErr {
    #[msg("label exceeds 32 bytes")]
    LabelTooLong,
    #[msg("only the creator can authorize transfers")]
    Unauthorized,
    #[msg("insufficient funds in wallet PDA")]
    InsufficientFunds,
    #[msg("arithmetic overflow")]
    MathOverflow,
}
