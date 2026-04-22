//! DPO2U Compliance Registry — Pinocchio port of the Anchor 0.31.1 program.
//!
//! Paridade funcional com `programs/compliance-registry/src/lib.rs`:
//!   0x00 → create_attestation            (caller-asserted commitment, sem CPI)
//!   0x01 → create_verified_attestation   (CPI ao dpo2u-compliance-verifier SP1)
//!   0x02 → revoke_attestation            (mutação, só issuer original)
//!
//! Layout de bytes do instruction_data: [selector: u8][Borsh(args)].
//! Sem 8-byte Anchor discriminator na instruction — o dispatcher é manual.
//! O Attestation account é prefixado com 8 bytes de zero (pseudo-discriminator)
//! pra manter o cliente Anchor `BorshCoder` funcionando.
//!
//! Program ID (novo, não reutiliza o Anchor):
//!   FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8

extern crate alloc;

use alloc::{string::String, vec::Vec};
use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    entrypoint,
    instruction::{Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

pinocchio_pubkey::declare_id!("FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8");

/// Verifier pinado — mesmo endereço do Anchor original (`compliance-registry/src/lib.rs:29`).
const VERIFIER_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");

/// Seed principal do PDA (mesmo do Anchor).
const ATTESTATION_SEED: &[u8] = b"attestation";

/// Discriminator idêntico ao do Anchor para `Attestation` — primeiros 8 bytes
/// de sha256("account:Attestation"). Escrever este valor preserva
/// compatibilidade binária com clientes que decodificam via `BorshCoder` do
/// IDL Anchor existente (zero mudança no lado TS).
const ATTESTATION_DISCRIMINATOR: [u8; 8] = [152, 125, 183, 86, 36, 146, 121, 73];

/// Tamanho máximo do Attestation Borsh-serializado — casado com o `#[max_len]`
/// do programa Anchor: 32*4 + (4+128) + 8 + (1+8)*2 + (1+4+64) + 1 + 1 + 1 + 4.
const ATTESTATION_MAX_DATA: usize = 362;

/// Tamanho total da conta (pseudo-discriminator + dados).
const ATTESTATION_ACCOUNT_SPACE: usize = 8 + ATTESTATION_MAX_DATA;

/// Sizes do envelope SP1 v6 Groth16 — iguais ao Anchor.
const SP1_PROOF_BYTES: usize = 356;
const SP1_PUBLIC_INPUTS_BYTES: usize = 96;
const MAX_STORAGE_URI_LEN: usize = 128;
const MAX_REASON_LEN: usize = 64;

/// Limites numéricos dos ProgramError::Custom para cada erro domain-specific.
/// (Pinocchio não tem `#[error_code]`; cada erro é um u32 de custom_error_code.)
mod err {
    pub const STORAGE_URI_TOO_LONG: u32 = 0x1001;
    pub const REASON_TOO_LONG: u32 = 0x1002;
    pub const ALREADY_REVOKED: u32 = 0x1003;
    pub const UNAUTHORIZED: u32 = 0x1004;
    pub const INVALID_PROOF_SIZE: u32 = 0x1005;
    pub const INVALID_PUBLIC_VALUES_SIZE: u32 = 0x1006;
    pub const MALFORMED_PUBLIC_VALUES: u32 = 0x1007;
    pub const COMMITMENT_MISMATCH: u32 = 0x1008;
    pub const THRESHOLD_NOT_MET: u32 = 0x1009;
    pub const PROOF_SERIALIZATION_FAILED: u32 = 0x100A;
    pub const VERIFICATION_FAILED: u32 = 0x100B;
    pub const WRONG_VERIFIER_PROGRAM: u32 = 0x100C;
    pub const WRONG_SYSTEM_PROGRAM: u32 = 0x100D;
    pub const WRONG_PDA: u32 = 0x100E;
    pub const ISSUER_NOT_SIGNER: u32 = 0x100F;
}

/// Borsh struct wire-compatível com sp1-solana/example/program — mesma ordem
/// de campos, sem discriminator.
#[derive(BorshSerialize, BorshDeserialize)]
struct SP1Groth16Proof {
    proof: Vec<u8>,
    sp1_public_inputs: Vec<u8>,
}

/// Args do create_attestation (selector 0x00).
#[derive(BorshDeserialize)]
struct CreateAttestationArgs {
    commitment: [u8; 32],
    storage_uri: String,
    schema_id: [u8; 32],
    expires_at: Option<i64>,
}

/// Args do create_verified_attestation (selector 0x01).
#[derive(BorshDeserialize)]
struct CreateVerifiedAttestationArgs {
    commitment: [u8; 32],
    proof: Vec<u8>,
    public_inputs: Vec<u8>,
    storage_uri: String,
    schema_id: [u8; 32],
    expires_at: Option<i64>,
}

/// Args do revoke_attestation (selector 0x02).
#[derive(BorshDeserialize)]
struct RevokeAttestationArgs {
    reason: String,
}

/// Mesmo layout do `#[account] Attestation` em Anchor.
#[derive(BorshSerialize, BorshDeserialize)]
struct Attestation {
    subject: [u8; 32],
    issuer: [u8; 32],
    schema_id: [u8; 32],
    commitment: [u8; 32],
    storage_uri: String,
    issued_at: i64,
    expires_at: Option<i64>,
    revoked_at: Option<i64>,
    revocation_reason: Option<String>,
    version: u8,
    bump: u8,
    verified: bool,
    threshold: u32,
}

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
        0x00 => create_attestation(program_id, accounts, rest),
        0x01 => create_verified_attestation(program_id, accounts, rest),
        0x02 => revoke_attestation(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// -----------------------------------------------------------------------------
// create_attestation (selector 0x00)
// -----------------------------------------------------------------------------

fn create_attestation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CreateAttestationArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    require_storage_uri(&args.storage_uri)?;

    // Accounts: [issuer(s,w), subject, attestation(w), system_program, rent_sysvar, clock_sysvar]
    let [issuer, subject, attestation, system_program, rent_sysvar, clock_sysvar] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(issuer)?;
    require_system_program(system_program)?;

    let bump = verify_and_create_attestation_pda(
        program_id,
        issuer,
        subject,
        attestation,
        rent_sysvar,
        &args.commitment,
    )?;

    let clock_ref = Clock::from_account_info(clock_sysvar)?;
    let issued_at = clock_ref.unix_timestamp;
    drop(clock_ref);
    let att = Attestation {
        subject: *subject.key(),
        issuer: *issuer.key(),
        schema_id: args.schema_id,
        commitment: args.commitment,
        storage_uri: args.storage_uri,
        issued_at,
        expires_at: args.expires_at,
        revoked_at: None,
        revocation_reason: None,
        version: 1,
        bump,
        verified: false,
        threshold: 0,
    };

    write_attestation(attestation, &att)?;

    log!("AttestationCreated verified=false");
    Ok(())
}

// -----------------------------------------------------------------------------
// create_verified_attestation (selector 0x01) — hot path com CPI SP1
// -----------------------------------------------------------------------------

fn create_verified_attestation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = CreateVerifiedAttestationArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    require_storage_uri(&args.storage_uri)?;
    require_eq(
        args.proof.len(),
        SP1_PROOF_BYTES,
        err::INVALID_PROOF_SIZE,
    )?;
    require_eq(
        args.public_inputs.len(),
        SP1_PUBLIC_INPUTS_BYTES,
        err::INVALID_PUBLIC_VALUES_SIZE,
    )?;

    // ABI-decode PublicValuesStruct (threshold/commitment/meets_threshold).
    // Layout idêntico ao Anchor em compliance-registry/src/lib.rs:105-112.
    let threshold_bytes: [u8; 4] = args.public_inputs[28..32]
        .try_into()
        .map_err(|_| ProgramError::Custom(err::MALFORMED_PUBLIC_VALUES))?;
    let threshold = u32::from_be_bytes(threshold_bytes);
    let decoded_commitment: [u8; 32] = args.public_inputs[32..64]
        .try_into()
        .map_err(|_| ProgramError::Custom(err::MALFORMED_PUBLIC_VALUES))?;
    let meets_threshold = args.public_inputs[95] != 0;

    if args.commitment != decoded_commitment {
        return Err(ProgramError::Custom(err::COMMITMENT_MISMATCH));
    }
    if !meets_threshold {
        return Err(ProgramError::Custom(err::THRESHOLD_NOT_MET));
    }

    // Accounts: [issuer(s,w), subject, attestation(w), verifier_program, system_program, rent_sysvar, clock_sysvar]
    let [
        issuer,
        subject,
        attestation,
        verifier_program,
        system_program,
        rent_sysvar,
        clock_sysvar,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(issuer)?;
    require_system_program(system_program)?;
    if verifier_program.key() != &VERIFIER_PROGRAM_ID {
        return Err(ProgramError::Custom(err::WRONG_VERIFIER_PROGRAM));
    }

    // CPI ao verifier SP1 ANTES do init — se a prova não validar, a tx
    // inteira reverte e a conta nunca é criada.
    //
    // Wire format (idêntico ao Borsh de SP1Groth16Proof { proof, sp1_public_inputs },
    // mas escrito manualmente pra eliminar qualquer discrepância de encoding):
    //   [u32 LE proof_len][proof bytes][u32 LE public_inputs_len][public_inputs bytes]
    let mut ix_data = Vec::with_capacity(
        4 + SP1_PROOF_BYTES + 4 + SP1_PUBLIC_INPUTS_BYTES,
    );
    ix_data.extend_from_slice(&(args.proof.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&args.proof);
    ix_data.extend_from_slice(&(args.public_inputs.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&args.public_inputs);

    let verifier_instruction = Instruction {
        program_id: verifier_program.key(),
        accounts: &[],
        data: &ix_data,
    };
    invoke_signed::<1>(&verifier_instruction, &[verifier_program], &[])
        .map_err(|_| ProgramError::Custom(err::VERIFICATION_FAILED))?;

    log!("verifier OK, deriving PDA");

    let bump = verify_and_create_attestation_pda(
        program_id,
        issuer,
        subject,
        attestation,
        rent_sysvar,
        &args.commitment,
    )?;

    let clock_ref = Clock::from_account_info(clock_sysvar)?;
    let issued_at = clock_ref.unix_timestamp;
    drop(clock_ref);

    let att = Attestation {
        subject: *subject.key(),
        issuer: *issuer.key(),
        schema_id: args.schema_id,
        commitment: args.commitment,
        storage_uri: args.storage_uri,
        issued_at,
        expires_at: args.expires_at,
        revoked_at: None,
        revocation_reason: None,
        version: 1,
        bump,
        verified: true,
        threshold,
    };

    write_attestation(attestation, &att)?;

    log!("VerifiedAttestationCreated threshold={}", threshold);
    Ok(())
}

// -----------------------------------------------------------------------------
// revoke_attestation (selector 0x02)
// -----------------------------------------------------------------------------

fn revoke_attestation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RevokeAttestationArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.reason.len() > MAX_REASON_LEN {
        return Err(ProgramError::Custom(err::REASON_TOO_LONG));
    }

    // Accounts: [issuer(s), attestation(w), clock_sysvar]
    let [issuer, attestation, clock_sysvar] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    require_signer(issuer)?;

    // Ler conta existente, pular os 8 bytes de pseudo-discriminator.
    let mut att = {
        let data_ref = attestation.try_borrow_data()?;
        if data_ref.len() < 8 {
            return Err(ProgramError::AccountDataTooSmall);
        }
        Attestation::try_from_slice(&data_ref[8..])
            .map_err(|_| ProgramError::InvalidAccountData)?
    };

    // Recalcular PDA esperada a partir dos campos gravados. Qualquer
    // substituição de conta falha aqui.
    let (expected_pda, _bump) = find_program_address(
        &[ATTESTATION_SEED, &att.subject, &att.commitment],
        program_id,
    );
    if attestation.key() != &expected_pda {
        return Err(ProgramError::Custom(err::WRONG_PDA));
    }

    if att.revoked_at.is_some() {
        return Err(ProgramError::Custom(err::ALREADY_REVOKED));
    }
    if &att.issuer != issuer.key() {
        return Err(ProgramError::Custom(err::UNAUTHORIZED));
    }

    let clock_ref = Clock::from_account_info(clock_sysvar)?;
    att.revoked_at = Some(clock_ref.unix_timestamp);
    att.revocation_reason = Some(args.reason);
    drop(clock_ref);

    write_attestation(attestation, &att)?;

    log!("AttestationRevoked");
    Ok(())
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

fn require_storage_uri(uri: &str) -> ProgramResult {
    if uri.len() > MAX_STORAGE_URI_LEN {
        Err(ProgramError::Custom(err::STORAGE_URI_TOO_LONG))
    } else {
        Ok(())
    }
}

fn require_signer(account: &AccountInfo) -> ProgramResult {
    if account.is_signer() {
        Ok(())
    } else {
        Err(ProgramError::Custom(err::ISSUER_NOT_SIGNER))
    }
}

fn require_system_program(account: &AccountInfo) -> ProgramResult {
    // System program ID: 11111111111111111111111111111111 = [0u8; 32]
    if account.key() == &[0u8; 32] {
        Ok(())
    } else {
        Err(ProgramError::Custom(err::WRONG_SYSTEM_PROGRAM))
    }
}

fn require_eq(actual: usize, expected: usize, err_code: u32) -> ProgramResult {
    if actual == expected {
        Ok(())
    } else {
        Err(ProgramError::Custom(err_code))
    }
}

/// Deriva o PDA esperado, confirma `accounts.attestation.key() == expected`,
/// e cria a conta via CPI ao system program com os seeds como signer.
/// Retorna o bump encontrado (pra gravar no struct Attestation).
fn verify_and_create_attestation_pda(
    program_id: &Pubkey,
    issuer: &AccountInfo,
    subject: &AccountInfo,
    attestation: &AccountInfo,
    rent_sysvar: &AccountInfo,
    commitment: &[u8; 32],
) -> Result<u8, ProgramError> {
    let (expected_pda, bump) = find_program_address(
        &[ATTESTATION_SEED, subject.key(), commitment],
        program_id,
    );
    if attestation.key() != &expected_pda {
        return Err(ProgramError::Custom(err::WRONG_PDA));
    }

    // Rent via account-info fallback — pinocchio 0.9 `Rent::get()` usa o syscall
    // genérico `sol_get_sysvar`, que alguns runtimes (incluindo bankrun estável)
    // não registram. Passar o sysvar account explicitamente é canônico pré-1.18.
    let rent_ref = Rent::from_account_info(rent_sysvar)?;
    let lamports = rent_ref.minimum_balance(ATTESTATION_ACCOUNT_SPACE);
    drop(rent_ref);

    let bump_seed = [bump];
    let seeds_array: [Seed; 4] = [
        Seed::from(ATTESTATION_SEED),
        Seed::from(subject.key().as_slice()),
        Seed::from(commitment.as_slice()),
        Seed::from(bump_seed.as_slice()),
    ];
    let signer = Signer::from(&seeds_array);

    CreateAccount {
        from: issuer,
        to: attestation,
        lamports,
        space: ATTESTATION_ACCOUNT_SPACE as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    Ok(bump)
}

/// Serializa um `Attestation` e escreve na conta prefixado pelo
/// pseudo-discriminator de 8 bytes.
fn write_attestation(account: &AccountInfo, att: &Attestation) -> ProgramResult {
    let mut data = account.try_borrow_mut_data()?;
    if data.len() < ATTESTATION_ACCOUNT_SPACE {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[0..8].copy_from_slice(&ATTESTATION_DISCRIMINATOR);

    let mut cursor = &mut data[8..];
    att.serialize(&mut cursor)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

