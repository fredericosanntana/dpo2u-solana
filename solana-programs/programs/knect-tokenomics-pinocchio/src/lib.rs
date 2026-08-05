// Kolibri KNECT Tokenomics — Pinocchio
// =====================================
//
// Implements the atomic phased revenue split from the KNECT White Paper v2.1 §04
// (Receita do protocolo — split automático por fase). The mechanism is generic
// (bps sum == 10_000, fundo absorbs rounding); the canonical bps come from the WP:
//
//   Fase 1 (construção):  50% KBR · 25% Buyback→Reserva de Cashback · 0% Staking · 25% Fundo
//   Fase 2 (maturidade):  25% KBR · 25% Buyback→Reserva de Cashback · 25% Staking · 25% Fundo
//
//   KBR Vault     — cbBTC via Jupiter DCA semanal (lastro / floor)
//   Buyback       — compra KNECT no mercado → Reserva de Cashback (SEM QUEIMA; a
//                   única queima é no resgate ao floor, fora deste programa)
//   Staking       — Pool de Staking USDC (0% na Fase 1; ativo só na Fase 2, gated por parecer)
//   Fundo Kolibri — operação (multi-sig 3/5)
//
//   Transição Fase 1 → Fase 2 é unidirecional via update_splits (0x02), gated a Squads.
//
// Selectors:
//   0x00 initialize_config — admin sets 4 vaults + bps splits + admin pubkey
//   0x01 distribute        — atomic 4-way split via SPL token transfer_checked
//                             (4 transfer CPIs, one tx; reverts if any fails)
//   0x02 update_splits     — admin can tune bps (Squads-gated post-mainnet)
//
// Design choices:
//   - Pinocchio (not Anchor) for ~5x lower CU on hot path
//   - bps (basis points) sum MUST equal 10_000 — checked at init + update
//   - last vault absorbs rounding (no leakage) — `share_4 = amount - share_1 - share_2 - share_3`
//   - source_ata signer = the wallet receiving 0.4% take rate from a Cloak tx
//   - phase transition (Fase 1 → Fase 2) and buyback→cashback orchestration are
//     OFF-CHAIN (gateway); this program only does the deterministic split. The
//     buyback vault ACCUMULATES (no burn) — cashback is paid from it off-chain.
//
// Program ID: Emhv7pBYgqyYQ2Bzcbi8nXphA1AmgoWmU7aKKxCNbk2v (devnet, will rotate before mainnet)

#![allow(dead_code, unused_imports, unexpected_cfgs)]

extern crate alloc;

use alloc::vec::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    entrypoint,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

pinocchio_pubkey::declare_id!("Emhv7pBYgqyYQ2Bzcbi8nXphA1AmgoWmU7aKKxCNbk2v");

const CONFIG_SEED: &[u8] = b"knect_config";

/// SPL Token program ID (legacy). Token-2022 support deferred to v2.
const SPL_TOKEN_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Pseudo-discriminator (Anchor-compatible BorshCoder readers can decode the body).
const KNECT_CONFIG_DISCRIMINATOR: [u8; 8] = [223, 18, 91, 144, 207, 33, 86, 12];

mod err {
    pub const BPS_SUM_MISMATCH: u32 = 0x4001;
    pub const NOT_ADMIN: u32 = 0x4002;
    pub const WRONG_PDA: u32 = 0x4003;
    pub const WRONG_TOKEN_PROGRAM: u32 = 0x4004;
    pub const VAULT_OWNER_MISMATCH: u32 = 0x4005;
    pub const VAULT_MINT_MISMATCH: u32 = 0x4006;
    pub const AMOUNT_ZERO: u32 = 0x4007;
    pub const ARITHMETIC_OVERFLOW: u32 = 0x4008;
    pub const ALREADY_INITIALIZED: u32 = 0x4009;
    pub const NOT_INITIALIZED: u32 = 0x400A;
    pub const SIGNER_REQUIRED: u32 = 0x400B;
}

const TOTAL_BPS: u16 = 10_000;

// =============================================================================
// State
// =============================================================================

/// Stored at PDA seeded by [b"knect_config", admin_pubkey].
/// Singleton per admin — supports multi-tenant if Kolibri scales to multiple
/// economic regimes (e.g. one config per region). For MVP, one admin.
#[derive(BorshSerialize, BorshDeserialize)]
struct KnectConfig {
    admin: [u8; 32],
    fee_token_mint: [u8; 32],

    // 4 destination vaults (token account addresses, NOT owners)
    vault_kbr: [u8; 32],      // KBR — cbBTC vault (or USDC pre-cbBTC-DCA) — lastro
    vault_buyback: [u8; 32],  // Buyback → Reserva de Cashback (NO burn)
    vault_staking: [u8; 32],  // Pool Staking USDC (0% in Fase 1; active Fase 2)
    vault_fundo: [u8; 32],    // Fundo Kolibri (multi-sig 3/5) — absorbs rounding

    // Splits in basis points (sum must == TOTAL_BPS = 10_000)
    bps_kbr: u16,
    bps_buyback: u16,
    bps_staking: u16,
    bps_fundo: u16,

    // Telemetry (cheap atomic accumulators for off-chain dashboards)
    total_distributed: u64,
    distributions_count: u32,
    last_distribution_at: i64,

    bump: u8,
    schema_version: u8,
}

// Borsh size: 32*6 + 2*4 + 8 + 4 + 8 + 1 + 1 = 192 + 8 + 8 + 4 + 8 + 2 = 222 bytes
const CONFIG_MAX_DATA: usize = 222;
const CONFIG_ACCOUNT_SPACE: usize = 8 + CONFIG_MAX_DATA;

// =============================================================================
// Instruction args
// =============================================================================

#[derive(BorshDeserialize)]
struct InitializeConfigArgs {
    fee_token_mint: [u8; 32],
    vault_kbr: [u8; 32],
    vault_buyback: [u8; 32],
    vault_staking: [u8; 32],
    vault_fundo: [u8; 32],
    bps_kbr: u16,
    bps_buyback: u16,
    bps_staking: u16,
    bps_fundo: u16,
}

#[derive(BorshDeserialize)]
struct DistributeArgs {
    amount: u64,
}

#[derive(BorshDeserialize)]
struct UpdateSplitsArgs {
    bps_kbr: u16,
    bps_buyback: u16,
    bps_staking: u16,
    bps_fundo: u16,
}

// =============================================================================
// Entrypoint
// =============================================================================

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (selector, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match *selector {
        0x00 => initialize_config(program_id, accounts, rest),
        0x01 => distribute(program_id, accounts, rest),
        0x02 => update_splits(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// =============================================================================
// 0x00 initialize_config
// =============================================================================
//
// Accounts:
//   [0] admin           (signer, writable, fee payer)
//   [1] config_pda      (writable, PDA seed [b"knect_config", admin])
//   [2] system_program
//   [3] rent_sysvar

fn initialize_config(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = InitializeConfigArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let sum: u32 = (args.bps_kbr as u32)
        + (args.bps_buyback as u32)
        + (args.bps_staking as u32)
        + (args.bps_fundo as u32);
    if sum != TOTAL_BPS as u32 {
        return Err(ProgramError::Custom(err::BPS_SUM_MISMATCH));
    }

    let [admin, config_pda, system_program, rent_sysvar] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !admin.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }
    if system_program.key() != &[0u8; 32] {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Reject if already initialized (lamports > 0 means PDA already exists).
    if config_pda.lamports() > 0 {
        return Err(ProgramError::Custom(err::ALREADY_INITIALIZED));
    }

    let (expected_pda, bump) = find_program_address(&[CONFIG_SEED, admin.key()], program_id);
    if config_pda.key() != &expected_pda {
        return Err(ProgramError::Custom(err::WRONG_PDA));
    }

    let rent_ref = Rent::from_account_info(rent_sysvar)?;
    let lamports = rent_ref.minimum_balance(CONFIG_ACCOUNT_SPACE);
    drop(rent_ref);

    let bump_seed = [bump];
    let seeds: [Seed; 3] = [
        Seed::from(CONFIG_SEED),
        Seed::from(admin.key().as_slice()),
        Seed::from(bump_seed.as_slice()),
    ];
    let signer_seeds = Signer::from(&seeds);

    CreateAccount {
        from: admin,
        to: config_pda,
        lamports,
        space: CONFIG_ACCOUNT_SPACE as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer_seeds])?;

    let cfg = KnectConfig {
        admin: *admin.key(),
        fee_token_mint: args.fee_token_mint,
        vault_kbr: args.vault_kbr,
        vault_buyback: args.vault_buyback,
        vault_staking: args.vault_staking,
        vault_fundo: args.vault_fundo,
        bps_kbr: args.bps_kbr,
        bps_buyback: args.bps_buyback,
        bps_staking: args.bps_staking,
        bps_fundo: args.bps_fundo,
        total_distributed: 0,
        distributions_count: 0,
        last_distribution_at: 0,
        bump,
        schema_version: 1,
    };

    write_config(config_pda, &cfg)?;
    log!(
        "KnectConfigInitialized bps={}+{}+{}+{}",
        args.bps_kbr,
        args.bps_buyback,
        args.bps_staking,
        args.bps_fundo
    );
    Ok(())
}

// =============================================================================
// 0x01 distribute — atomic 4-way split
// =============================================================================
//
// Accounts (in order — order matters for the 4 CPIs):
//   [0] payer            (signer; owner of source_ata)
//   [1] config_pda       (readonly, validates splits)
//   [2] source_ata       (writable, holds the incoming amount in fee_token_mint)
//   [3] vault_kbr_ata    (writable)
//   [4] vault_buyback_ata (writable)
//   [5] vault_staking_ata (writable)
//   [6] vault_fundo_ata  (writable)
//   [7] fee_token_mint   (readonly — passed for transfer_checked)
//   [8] token_program    (SPL Token program)
//
// The 4 destination ATAs MUST match the config's vault addresses (validated).

fn distribute(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let args = DistributeArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.amount == 0 {
        return Err(ProgramError::Custom(err::AMOUNT_ZERO));
    }

    let [
        payer,
        config_pda,
        source_ata,
        vault_kbr,
        vault_buyback,
        vault_staking,
        vault_fundo,
        fee_token_mint,
        token_program,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }
    if token_program.key() != &SPL_TOKEN_PROGRAM_ID {
        return Err(ProgramError::Custom(err::WRONG_TOKEN_PROGRAM));
    }

    let mut cfg = read_config(config_pda)?;
    if cfg.schema_version == 0 {
        return Err(ProgramError::Custom(err::NOT_INITIALIZED));
    }

    // Validate that the 4 dest accounts match config'd vaults.
    if vault_kbr.key() != &cfg.vault_kbr {
        return Err(ProgramError::Custom(err::VAULT_OWNER_MISMATCH));
    }
    if vault_buyback.key() != &cfg.vault_buyback {
        return Err(ProgramError::Custom(err::VAULT_OWNER_MISMATCH));
    }
    if vault_staking.key() != &cfg.vault_staking {
        return Err(ProgramError::Custom(err::VAULT_OWNER_MISMATCH));
    }
    if vault_fundo.key() != &cfg.vault_fundo {
        return Err(ProgramError::Custom(err::VAULT_OWNER_MISMATCH));
    }
    if fee_token_mint.key() != &cfg.fee_token_mint {
        return Err(ProgramError::Custom(err::VAULT_MINT_MISMATCH));
    }

    // Compute splits. Last vault (fundo) absorbs rounding to keep sum exact.
    let amount = args.amount as u128;
    let share_kbr = amount
        .checked_mul(cfg.bps_kbr as u128)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?
        / TOTAL_BPS as u128;
    let share_buyback = amount
        .checked_mul(cfg.bps_buyback as u128)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?
        / TOTAL_BPS as u128;
    let share_staking = amount
        .checked_mul(cfg.bps_staking as u128)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?
        / TOTAL_BPS as u128;
    // Fundo absorbs the rounding remainder so the 4 shares sum exactly to amount.
    let allocated = share_kbr
        .checked_add(share_buyback)
        .and_then(|x| x.checked_add(share_staking))
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    let share_fundo = amount
        .checked_sub(allocated)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;

    // Read decimals from the mint (offset 44 in Mint account data — Token Program v1 layout).
    // Mint layout: mint_authority(36) + supply(8) + decimals(1) + ...
    // After the 36-byte coption + 8-byte supply: decimals = byte 44.
    let decimals = {
        let mint_data = fee_token_mint.try_borrow_data()?;
        if mint_data.len() < 45 {
            return Err(ProgramError::InvalidAccountData);
        }
        mint_data[44]
    };

    // 4 atomic CPIs — if any fails, the whole tx reverts and no vault is debited.
    spl_transfer_checked(
        token_program,
        source_ata,
        fee_token_mint,
        vault_kbr,
        payer,
        share_kbr as u64,
        decimals,
    )?;
    spl_transfer_checked(
        token_program,
        source_ata,
        fee_token_mint,
        vault_buyback,
        payer,
        share_buyback as u64,
        decimals,
    )?;
    spl_transfer_checked(
        token_program,
        source_ata,
        fee_token_mint,
        vault_staking,
        payer,
        share_staking as u64,
        decimals,
    )?;
    spl_transfer_checked(
        token_program,
        source_ata,
        fee_token_mint,
        vault_fundo,
        payer,
        share_fundo as u64,
        decimals,
    )?;

    // Update telemetry.
    cfg.total_distributed = cfg
        .total_distributed
        .checked_add(args.amount)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    cfg.distributions_count = cfg
        .distributions_count
        .checked_add(1)
        .ok_or(ProgramError::Custom(err::ARITHMETIC_OVERFLOW))?;
    // last_distribution_at left as-is; reading Clock here costs CU; off-chain
    // can use tx blocktime. Keep field for forward compat (future Clock CPI).

    write_config(config_pda, &cfg)?;

    log!(
        "KnectDistributed kbr={} buyback={} staking={} fundo={}",
        share_kbr as u64,
        share_buyback as u64,
        share_staking as u64,
        share_fundo as u64
    );
    Ok(())
}

// =============================================================================
// 0x02 update_splits — admin re-tunes bps (Squads-gated post-mainnet)
// =============================================================================

fn update_splits(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let args = UpdateSplitsArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let sum: u32 = (args.bps_kbr as u32)
        + (args.bps_buyback as u32)
        + (args.bps_staking as u32)
        + (args.bps_fundo as u32);
    if sum != TOTAL_BPS as u32 {
        return Err(ProgramError::Custom(err::BPS_SUM_MISMATCH));
    }

    let [admin, config_pda] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() {
        return Err(ProgramError::Custom(err::SIGNER_REQUIRED));
    }

    let mut cfg = read_config(config_pda)?;
    if &cfg.admin != admin.key() {
        return Err(ProgramError::Custom(err::NOT_ADMIN));
    }

    cfg.bps_kbr = args.bps_kbr;
    cfg.bps_buyback = args.bps_buyback;
    cfg.bps_staking = args.bps_staking;
    cfg.bps_fundo = args.bps_fundo;
    write_config(config_pda, &cfg)?;
    log!(
        "KnectSplitsUpdated bps={}+{}+{}+{}",
        args.bps_kbr,
        args.bps_buyback,
        args.bps_staking,
        args.bps_fundo
    );
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

fn write_config(account: &AccountInfo, cfg: &KnectConfig) -> ProgramResult {
    let mut data = account.try_borrow_mut_data()?;
    if data.len() < CONFIG_ACCOUNT_SPACE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[0..8].copy_from_slice(&KNECT_CONFIG_DISCRIMINATOR);
    let mut cursor = &mut data[8..];
    cfg.serialize(&mut cursor)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

fn read_config(account: &AccountInfo) -> Result<KnectConfig, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 + 1 {
        return Err(ProgramError::Custom(err::NOT_INITIALIZED));
    }
    if &data[0..8] != KNECT_CONFIG_DISCRIMINATOR {
        return Err(ProgramError::Custom(err::NOT_INITIALIZED));
    }
    KnectConfig::try_from_slice(&data[8..])
        .map_err(|_| ProgramError::InvalidAccountData)
}

/// Manual SPL Token `transfer_checked` CPI — Pinocchio doesn't import the
/// full helper from pinocchio-token 0.6 the way we need, so we build the
/// instruction by hand. Wire format:
///   data: [3, amount_le_u64, decimals_u8]
/// accounts: [source(writable), mint(readonly), destination(writable), authority(signer)]
fn spl_transfer_checked(
    token_program: &AccountInfo,
    source: &AccountInfo,
    mint: &AccountInfo,
    destination: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    decimals: u8,
) -> ProgramResult {
    let mut ix_data = Vec::with_capacity(10);
    ix_data.push(12u8); // SPL Token instruction index for TransferChecked = 12
    ix_data.extend_from_slice(&amount.to_le_bytes());
    ix_data.push(decimals);

    let metas = [
        AccountMeta {
            pubkey: source.key(),
            is_writable: true,
            is_signer: false,
        },
        AccountMeta {
            pubkey: mint.key(),
            is_writable: false,
            is_signer: false,
        },
        AccountMeta {
            pubkey: destination.key(),
            is_writable: true,
            is_signer: false,
        },
        AccountMeta {
            pubkey: authority.key(),
            is_writable: false,
            is_signer: true,
        },
    ];

    let ix = Instruction {
        program_id: token_program.key(),
        accounts: &metas,
        data: &ix_data,
    };

    invoke_signed::<4>(
        &ix,
        &[source, mint, destination, authority],
        &[],
    )
}
