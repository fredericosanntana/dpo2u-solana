//! DPO2U Payment Gateway
//!
//! Creates invoices and settles them atomically via SPL Token CPI.
//! `settle_invoice` moves `settled_amount` tokens from `payer_token_account` to
//! `payee_token_account` via `anchor_spl::token::transfer_checked` (signed by
//! payer) and records `settled_at`. Mint invariant enforced: both ATAs must
//! hold the same mint declared on `invoice.mint`.
//!
//! Invoice PDA seeds: [b"invoice", payer, tool_name_bytes, nonce_le_bytes]
//! enabling idempotent settlement per (payer, tool, nonce).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q");

#[program]
pub mod payment_gateway {
    use super::*;

    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        tool_name: String,
        amount: u64,
        mint: Pubkey,
        nonce: u64,
    ) -> Result<()> {
        require!(tool_name.len() <= 64, PaymentErr::ToolNameTooLong);

        let clock = Clock::get()?;
        let inv = &mut ctx.accounts.invoice;
        inv.payer = ctx.accounts.payer.key();
        inv.payee = ctx.accounts.payee.key();
        inv.amount = amount;
        inv.mint = mint;
        inv.tool_name = tool_name.clone();
        inv.nonce = nonce;
        inv.created_at = clock.unix_timestamp;
        inv.settled_at = None;
        inv.bump = ctx.bumps.invoice;

        emit!(InvoiceCreated {
            payer: inv.payer,
            payee: inv.payee,
            amount,
            tool_name,
            nonce,
        });
        Ok(())
    }

    pub fn settle_invoice(ctx: Context<SettleInvoice>, settled_amount: u64) -> Result<()> {
        let clock = Clock::get()?;
        let inv = &ctx.accounts.invoice;
        require!(inv.settled_at.is_none(), PaymentErr::AlreadySettled);
        require!(settled_amount >= inv.amount, PaymentErr::InsufficientPayment);
        require_keys_eq!(inv.payer, ctx.accounts.payer.key(), PaymentErr::Unauthorized);
        require_keys_eq!(ctx.accounts.mint.key(), inv.mint, PaymentErr::MintMismatch);
        require_keys_eq!(
            ctx.accounts.payer_token_account.mint,
            inv.mint,
            PaymentErr::MintMismatch
        );
        require_keys_eq!(
            ctx.accounts.payee_token_account.mint,
            inv.mint,
            PaymentErr::MintMismatch
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.payer_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.payee_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        token::transfer_checked(cpi_ctx, settled_amount, ctx.accounts.mint.decimals)?;

        let tool_name = inv.tool_name.clone();
        let nonce = inv.nonce;
        let payer_key = inv.payer;
        let payee_key = inv.payee;

        let inv = &mut ctx.accounts.invoice;
        inv.settled_at = Some(clock.unix_timestamp);

        emit!(PaymentSettled {
            payer: payer_key,
            payee: payee_key,
            amount: settled_amount,
            tool_name,
            nonce,
            settled_at: clock.unix_timestamp,
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Invoice {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    #[max_len(64)]
    pub tool_name: String,
    pub nonce: u64,
    pub created_at: i64,
    pub settled_at: Option<i64>,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(tool_name: String, amount: u64, mint: Pubkey, nonce: u64)]
pub struct CreateInvoice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: payee is any pubkey (DPO2U treasury or operator)
    pub payee: AccountInfo<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Invoice::INIT_SPACE,
        seeds = [b"invoice", payer.key().as_ref(), tool_name.as_bytes(), &nonce.to_le_bytes()],
        bump
    )]
    pub invoice: Account<'info, Invoice>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleInvoice<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"invoice", invoice.payer.as_ref(), invoice.tool_name.as_bytes(), &invoice.nonce.to_le_bytes()], bump = invoice.bump)]
    pub invoice: Account<'info, Invoice>,
    #[account(mut)]
    pub payer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payee_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct InvoiceCreated {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub tool_name: String,
    pub nonce: u64,
}

#[event]
pub struct PaymentSettled {
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub tool_name: String,
    pub nonce: u64,
    pub settled_at: i64,
}

#[error_code]
pub enum PaymentErr {
    #[msg("tool_name exceeds 64 bytes")]
    ToolNameTooLong,
    #[msg("invoice already settled")]
    AlreadySettled,
    #[msg("settled amount less than invoice amount")]
    InsufficientPayment,
    #[msg("only the invoice payer can settle")]
    Unauthorized,
    #[msg("mint or token account mint does not match invoice.mint")]
    MintMismatch,
}
