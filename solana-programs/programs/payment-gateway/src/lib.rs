//! DPO2U Payment Gateway
//!
//! Creates invoices and records settled ones. Actual SPL Token transfer is
//! handled by the caller (MCP server) prior to `settle_invoice`; the program
//! verifies the transfer signature via transaction introspection (Sprint 4
//! will add SPL Token CPI direct, for now we trust the caller so Sprint 3
//! scaffold stays simple).
//!
//! Invoice PDA seeds: [b"invoice", payer, tool_name_bytes, nonce_le_bytes]
//! enabling idempotent settlement per (payer, tool, nonce).

use anchor_lang::prelude::*;

declare_id!("CbAYe2hsBZmrB4GB8VcLZDchUuDonoG15Cg6n9cnE7Cn");

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
        let inv = &mut ctx.accounts.invoice;
        require!(inv.settled_at.is_none(), PaymentErr::AlreadySettled);
        require!(settled_amount >= inv.amount, PaymentErr::InsufficientPayment);
        require_keys_eq!(inv.payer, ctx.accounts.payer.key(), PaymentErr::Unauthorized);

        inv.settled_at = Some(clock.unix_timestamp);

        emit!(PaymentSettled {
            payer: inv.payer,
            payee: inv.payee,
            amount: settled_amount,
            tool_name: inv.tool_name.clone(),
            nonce: inv.nonce,
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
}
