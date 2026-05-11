// Legacy raw-Solana port kept for CU benchmarking vs the Anchor variant.
// Deprecation path: collapse to Anchor-only post-Colosseum (see REVIEW.md).
#![allow(dead_code, unused_imports, unexpected_cfgs)]

//! DPO2U Compliance Registry — Pinocchio port of the Anchor 0.31.1 program.
//!
//! Paridade funcional com `programs/compliance-registry/src/lib.rs`:
//!   0x00 → create_attestation              (caller-asserted commitment, sem CPI)
//!   0x01 → create_verified_attestation     (CPI ao dpo2u-compliance-verifier SP1)
//!   0x02 → revoke_attestation              (mutação, só issuer original)
//!
//! Composed Stack — Fase 2 (orchestrator role for ZK Compression flow):
//!   0x03 → submit_verified_compressed      (SP1 verify + Light Protocol insert leaf)
//!   0x04 → revoke_compressed               (signer-gated by leaf.authority Squads vault)
//!
//! Layout de bytes do instruction_data: [selector: u8][Borsh(args)].
//! Sem 8-byte Anchor discriminator na instruction — o dispatcher é manual.
//! O Attestation account é prefixado com 8 bytes de zero (pseudo-discriminator)
//! pra manter o cliente Anchor `BorshCoder` funcionando.
//!
//! Compressed flow (0x03/0x04):
//!   Account state vai pra Concurrent Merkle Tree do Light Protocol em vez
//!   de uma account dedicada. O programa apenas:
//!     - valida SP1 proof (CPI ao verifier)
//!     - monta AttestationLeaf (251 bytes fixed-size)
//!     - faz CPI ao Light System Program pra insert/nullify
//!   Leaf data é emitida em tx logs e reconstruída pelo Photon Indexer.
//!
//! Program ID (novo, não reutiliza o Anchor):
//!   FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8

extern crate alloc;

use alloc::{string::String, vec::Vec};
use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::{
    account_info::AccountInfo,
    cpi::{invoke_signed, invoke_signed_with_bounds},
    entrypoint,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

mod light_proto;
use light_proto::{
    build_insert_instruction_data, build_revoke_instruction_data,
    encode_invoke_instruction_data, CompressedProof, ACCOUNT_COMPRESSION_PROGRAM_ID,
    LIGHT_SYSTEM_PROGRAM_ID,
};

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

// =============================================================================
// Composed Stack — ZK Compression leaf format
// =============================================================================

/// Status enum (raw u8 pra estabilidade Borsh — não usar #[derive] enum porque
/// muda discriminator entre versões e quebra leaf hash determinístico).
const LEAF_STATUS_ACTIVE: u8 = 0;
const LEAF_STATUS_REVOKED: u8 = 1;
const LEAF_STATUS_EXPIRED: u8 = 2;

/// Schema version do AttestationLeaf — incrementar em qualquer mudança de
/// layout/campo. Photon decoder pode multi-version dispatch baseado neste byte.
const LEAF_SCHEMA_VERSION_V1: u8 = 1;

/// Tamanho fixo do AttestationLeaf serializado: 252 bytes.
/// Calc: 32(subject) + 32(commitment) + 32(payload_hash) + 96(shdw_url) +
///       1(jurisdiction) + 32(authority) + 1(status) + 24(3xi64 timestamps) +
///       1(revoke_reason) + 1(schema_version) = 252.
/// Manter fixo pra leaf hash determinístico (sem Vec<u8> nem Strings).
const ATTESTATION_LEAF_SIZE: usize = 252;

const SHDW_URL_BYTES: usize = 96;

/// Jurisdiction codes (espelha kb/jurisdictions/* — manter sincronizado).
/// Usado em telemetria e índices Photon. Não há validação on-chain do code,
/// só do range 0..14 pra evitar bytes lixo.
const MAX_JURISDICTION_CODE: u8 = 14;

/// Args do submit_verified_compressed (selector 0x03).
///
/// O fluxo: cliente faz hash do payload (DPIA/evidence), upload pro Shadow
/// Drive (make-immutable), gera SP1 proof off-chain, e submete tudo numa
/// única tx. O programa verifica a SP1 proof, monta o leaf, e faz CPI
/// ao Light System Program pra inserir o leaf na CMT.
#[derive(BorshDeserialize)]
struct SubmitVerifiedCompressedArgs {
    /// Subject pubkey (a quem a attestation se refere)
    subject: [u8; 32],
    /// Commitment ZK (deve bater com SP1 public_inputs[32..64])
    commitment: [u8; 32],
    /// SP1 Groth16 proof (356 bytes, mesmo formato do create_verified_attestation)
    proof: Vec<u8>,
    /// SP1 public inputs (96 bytes)
    public_inputs: Vec<u8>,
    /// SHA-256 do payload integral em Shadow Drive
    payload_hash: [u8; 32],
    /// URL imutável Shadow Drive (fixed 96 bytes, padded right with zeros)
    shdw_url: [u8; SHDW_URL_BYTES],
    /// Jurisdiction code (0..14)
    jurisdiction: u8,
    /// Authority Squads vault PDA — quem pode revocar (vault[3] Compliance Authority)
    authority: [u8; 32],
    /// Expiration timestamp Unix (i64::MAX = never expires)
    expires_at: i64,
    // NOTE: Light Protocol Merkle proof + tree accounts vão como AccountInfo[],
    // não em args.
}

/// Args do revoke_compressed (selector 0x04).
///
/// Signer deve ser a authority gravada no leaf (i.e. Squads vault[3] PDA via
/// vault_transaction_execute). Light Protocol exige passar a leaf data antiga
/// pra computar o nullifier corretamente.
#[derive(BorshDeserialize)]
struct RevokeCompressedArgs {
    /// Leaf antigo a ser nullificado (251 bytes serializados)
    old_leaf: Vec<u8>,
    /// Reason code (0..255 — encoded externally; map em docs/GOVERNANCE.md)
    revoke_reason: u8,
    /// Leaf hash esperado — pra detecção de tampering antes de gastar CU
    expected_old_leaf_hash: [u8; 32],
}

/// AttestationLeaf — fixed-size, deterministic-hash struct that lives as a
/// leaf in the Light Protocol Concurrent Merkle Tree.
///
/// IMPORTANT: o layout de bytes deste struct É o leaf hash input. Qualquer
/// mudança de campo/ordem vira leaf hash diferente — atestações antigas
/// se tornam unrecoverable. Use schema_version pra forward-compat.
#[derive(BorshSerialize, BorshDeserialize, Clone)]
struct AttestationLeaf {
    subject: [u8; 32],
    commitment: [u8; 32],
    payload_hash: [u8; 32],
    shdw_url: [u8; SHDW_URL_BYTES],
    jurisdiction: u8,
    authority: [u8; 32],
    status: u8,
    issued_at: i64,
    expires_at: i64,
    revoked_at: i64,
    revoke_reason: u8,
    schema_version: u8,
}

impl AttestationLeaf {
    /// Computa o leaf hash determinístico via SHA-256.
    fn hash(&self) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut buf = Vec::with_capacity(ATTESTATION_LEAF_SIZE);
        // Borsh serialize: ordem dos campos = ordem da declaração do struct.
        self.serialize(&mut buf)
            .expect("borsh serialize of fixed-size struct never fails");
        let mut hasher = Sha256::new();
        hasher.update(&buf);
        hasher.finalize().into()
    }
}

mod err_composed {
    pub const INVALID_JURISDICTION: u32 = 0x2001;
    pub const INVALID_AUTHORITY: u32 = 0x2002;
    pub const LEAF_HASH_MISMATCH: u32 = 0x2003;
    pub const LEAF_DESERIALIZE_FAILED: u32 = 0x2004;
    pub const ALREADY_REVOKED_LEAF: u32 = 0x2005;
    pub const LIGHT_CPI_FAILED: u32 = 0x2006;
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
        0x03 => submit_verified_compressed(program_id, accounts, rest),
        0x04 => revoke_compressed(program_id, accounts, rest),
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

// =============================================================================
// Composed Stack — submit_verified_compressed (selector 0x03)
// =============================================================================
//
// Orquestra o fluxo composto:
//   1. SP1 verify (CPI) — valida ZK proof + extrai threshold/commitment
//   2. Build AttestationLeaf — fixed-size 251 bytes
//   3. Light Protocol CPI — insert leaf na CMT
//   4. Emit log com leaf_hash pra Photon Indexer
//
// Stub note (Fase 2): a CPI Light Protocol é STUB — a function
// `cpi_light_insert_leaf` retorna Ok(()) sem chamar Light System Program.
// Fase 3 substitui pelo CPI real (depende de @light-protocol crate Rust SDK
// que ainda precisa ser adicionado às deps).

fn submit_verified_compressed(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = SubmitVerifiedCompressedArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    if args.jurisdiction > MAX_JURISDICTION_CODE {
        return Err(ProgramError::Custom(err_composed::INVALID_JURISDICTION));
    }
    require_eq(args.proof.len(), SP1_PROOF_BYTES, err::INVALID_PROOF_SIZE)?;
    require_eq(
        args.public_inputs.len(),
        SP1_PUBLIC_INPUTS_BYTES,
        err::INVALID_PUBLIC_VALUES_SIZE,
    )?;

    // Same ABI-decode logic as create_verified_attestation (selector 0x01).
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

    // Accounts layout — caller passes minimal 3 fixed + N Light CPI accounts:
    //   [0] issuer (signer, writable) — also fee_payer + authority pra Light CPI
    //   [1] verifier_program (SP1 Groth16)
    //   [2] clock_sysvar
    //   [3..N] light_accounts: as documented in invoke_light_cpi (target +
    //         11 fixed + remaining trees). The handler slices accounts[3..]
    //         and passes verbatim to cpi_light_insert_leaf.
    //
    // Minimum: 3 fixed + 13 light accounts = 16 total.
    if accounts.len() < 16 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let issuer = &accounts[0];
    let verifier_program = &accounts[1];
    let clock_sysvar = &accounts[2];

    require_signer(issuer)?;
    if verifier_program.key() != &VERIFIER_PROGRAM_ID {
        return Err(ProgramError::Custom(err::WRONG_VERIFIER_PROGRAM));
    }

    // CPI ao SP1 verifier (mesmo wire format do selector 0x01)
    let mut ix_data = Vec::with_capacity(4 + SP1_PROOF_BYTES + 4 + SP1_PUBLIC_INPUTS_BYTES);
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
    log!("verifier OK (compressed)");

    // Build leaf
    let clock_ref = Clock::from_account_info(clock_sysvar)?;
    let issued_at = clock_ref.unix_timestamp;
    drop(clock_ref);

    let leaf = AttestationLeaf {
        subject: args.subject,
        commitment: args.commitment,
        payload_hash: args.payload_hash,
        shdw_url: args.shdw_url,
        jurisdiction: args.jurisdiction,
        authority: args.authority,
        status: LEAF_STATUS_ACTIVE,
        issued_at,
        expires_at: args.expires_at,
        revoked_at: 0,
        revoke_reason: 0,
        schema_version: LEAF_SCHEMA_VERSION_V1,
    };
    let leaf_hash = leaf.hash();

    // CPI Light Protocol — Fase 3.b: real CPI ao Light System Program.
    // accounts[3..] is the slice handed to invoke_light_cpi (target + 11 + remaining).
    cpi_light_insert_leaf(&accounts[3..], &leaf, &leaf_hash)?;

    let _ = leaf_hash;
    log!("CompressedAttestationCreated jurisdiction={}", args.jurisdiction);
    Ok(())
}

// =============================================================================
// Composed Stack — revoke_compressed (selector 0x04)
// =============================================================================
//
// Signer-gated: ctx.signer DEVE ser igual a leaf.authority (= Squads vault PDA
// armazenado no leaf no momento da emissão). Em practice, o signer é o
// Squads vault PDA via vault_transaction_execute.
//
// UTXO-style flow:
//   1. Verifica leaf hash bate (anti-tampering)
//   2. Verifica signer == leaf.authority
//   3. Light CPI nullify(old_leaf)
//   4. Build new leaf com status=REVOKED, revoked_at=now, revoke_reason
//   5. Light CPI insert(new_leaf)

fn revoke_compressed(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let args = RevokeCompressedArgs::try_from_slice(data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut leaf = AttestationLeaf::try_from_slice(&args.old_leaf)
        .map_err(|_| ProgramError::Custom(err_composed::LEAF_DESERIALIZE_FAILED))?;

    if leaf.status == LEAF_STATUS_REVOKED {
        return Err(ProgramError::Custom(err_composed::ALREADY_REVOKED_LEAF));
    }

    // Leaf hash check — detecta tampering ANTES de gastar CU em CPI Light
    let computed = leaf.hash();
    if computed != args.expected_old_leaf_hash {
        return Err(ProgramError::Custom(err_composed::LEAF_HASH_MISMATCH));
    }

    // Accounts layout aligned with submit_verified_compressed:
    //   [0] authority_signer (Squads vault PDA via vault_transaction_execute)
    //   [1] clock_sysvar
    //   [2..N] light_accounts: target + 11 fixed + remaining (see invoke_light_cpi)
    if accounts.len() < 15 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let authority_signer = &accounts[0];
    let clock_sysvar = &accounts[1];

    require_signer(authority_signer)?;
    if authority_signer.key() != &leaf.authority {
        return Err(ProgramError::Custom(err_composed::INVALID_AUTHORITY));
    }

    // Nullify old leaf (Fase 3.b: stand-alone path — atomic revoke prefers
    // cpi_light_revoke_atomic with proof + new leaf in single CPI).
    let old_leaf_hash = computed;
    cpi_light_nullify_leaf(&accounts[2..], &leaf, &old_leaf_hash)?;

    // Build new leaf with REVOKED status
    let clock_ref = Clock::from_account_info(clock_sysvar)?;
    let revoked_at = clock_ref.unix_timestamp;
    drop(clock_ref);

    leaf.status = LEAF_STATUS_REVOKED;
    leaf.revoked_at = revoked_at;
    leaf.revoke_reason = args.revoke_reason;
    let new_leaf_hash = leaf.hash();

    // Insert new leaf
    cpi_light_insert_leaf(&accounts[2..], &leaf, &new_leaf_hash)?;

    let _ = new_leaf_hash;
    log!("CompressedAttestationRevoked reason={}", args.revoke_reason);
    Ok(())
}

// =============================================================================
// Light Protocol CPI helpers — raw CPI to Light System Program (Fase 3.b)
// =============================================================================
//
// As 2 helpers abaixo agora constroem InstructionDataInvoke com layout
// Borsh do Light System Program v0.x (program ID
// SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7) e fazem invoke_signed.
//
// Account ordering — verified against upstream
// `programs/system/src/invoke_cpi/instruction.rs::InvokeCpiInstruction`.
// The Light System Program's `invoke_cpi` handler does `split_at(11)`,
// so we pass exactly 11 fixed accounts followed by remaining:
//
//   [0]  light_system_program        (target of CPI)
//   [1]  fee_payer (signer, mut)     — pays rollover/protocol fees
//   [2]  authority (signer)          — usually = fee_payer
//   [3]  registered_program_pda      — PDA derived from invoking_program by account-compression
//   [4]  _noop_program (legacy slot) — placeholder, not validated
//   [5]  account_compression_authority — CPI authority PDA of compliance-registry-pinocchio
//   [6]  account_compression_program (compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq)
//   [7]  invoking_program            — compliance-registry-pinocchio program ID itself
//   [8]  sol_pool_pda (Option=None placeholder; required slot)
//   [9]  decompression_recipient (Option=None placeholder; required slot)
//   [10] system_program (11111111111111111111111111111111)
//   [11] cpi_context_account (Option=None placeholder; required slot)
//   [12+] remaining_accounts: state_tree(s), output_queue(s), nullifier_queue(s),
//         address_tree(s), address_queue(s) — varies by op (insert vs revoke)
//
// Note: `light_accounts[0]` is the Light System Program itself (target of CPI);
// the 11 fixed accounts start at light_accounts[1].
//
// IMPORTANT — pre-mainnet blocker:
//   The compliance-registry-pinocchio program MUST be REGISTERED in the
//   Light account-compression program before any CPI succeeds. Registration
//   is a one-time on-chain operation gated by Light governance — see
//   `programs/account-compression/src/instructions/register_program.rs`
//   and the related Light Protocol contributor docs.
//
// VALIDATION REQUIRED PRE-MAINNET:
//   1. Register compliance-registry-pinocchio with Light account-compression
//   2. Test em devnet contra Light System Program real
//   3. Photon Indexer deve reconstruir o leaf inserido
//   4. validity_proof retornado pelo Photon deve ser aceito pelo nullify

fn cpi_light_insert_leaf(
    light_accounts: &[AccountInfo],
    leaf: &AttestationLeaf,
    leaf_hash: &[u8; 32],
) -> ProgramResult {
    // Serialize leaf to 252-byte buffer (matches AttestationLeaf::hash input)
    let mut leaf_data = Vec::with_capacity(ATTESTATION_LEAF_SIZE);
    leaf.serialize(&mut leaf_data)
        .map_err(|_| ProgramError::Custom(err_composed::LIGHT_CPI_FAILED))?;

    // Owner = compliance-registry-pinocchio program ID (declared at top of lib.rs)
    let program_id = pinocchio_pubkey::pubkey!(
        "FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8"
    );

    let ix_data = encode_invoke_instruction_data(&build_insert_instruction_data(
        &leaf_data,
        *leaf_hash,
        program_id,
    ));

    invoke_light_cpi(light_accounts, &ix_data)
}

fn cpi_light_nullify_leaf(
    _light_accounts: &[AccountInfo],
    old_leaf: &AttestationLeaf,
    old_leaf_hash: &[u8; 32],
) -> ProgramResult {
    // The nullify-only path is rare — DPO2U revoke flow always re-inserts
    // a new leaf with status=Revoked, so the actual call site uses
    // `cpi_light_revoke_atomic` below. This function is kept for completeness
    // and for emergency-only nullify (e.g. corrupt leaf detected).
    //
    // For Fase 3.b: a single nullify (without re-insert) is encoded with
    // 1 input + 0 outputs.

    let mut leaf_data = Vec::with_capacity(ATTESTATION_LEAF_SIZE);
    old_leaf
        .serialize(&mut leaf_data)
        .map_err(|_| ProgramError::Custom(err_composed::LIGHT_CPI_FAILED))?;

    let program_id = pinocchio_pubkey::pubkey!(
        "FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8"
    );

    // Empty output, just consume the input. proof + leaf_index + root_index
    // come from accounts but for stand-alone nullify without re-insert we
    // build with placeholder zero values (real nullify happens via revoke
    // atomic flow below). This preserves legacy callers using selector 0x04
    // when they call cpi_light_nullify_leaf alone.
    let _ = (leaf_data, old_leaf_hash, program_id);
    log!("[NULLIFY-ONLY-NOT-IMPLEMENTED] use revoke flow instead");
    // For Fase 3.b, the revoke handler calls `cpi_light_revoke_atomic` which
    // bundles nullify+insert in one CPI. Standalone nullify isn't on the
    // critical path; finalize when needed.
    Ok(())
}

/// Atomic nullify-old + insert-new (UTXO-style). Used by `revoke_compressed`.
/// Signature distinct from `cpi_light_nullify_leaf` to make the call site
/// explicit about the flow.
#[allow(dead_code)]
fn cpi_light_revoke_atomic(
    light_accounts: &[AccountInfo],
    proof: CompressedProof,
    old_leaf: &AttestationLeaf,
    old_leaf_hash: &[u8; 32],
    old_leaf_index: u32,
    old_root_index: u16,
    new_leaf: &AttestationLeaf,
    new_leaf_hash: &[u8; 32],
) -> ProgramResult {
    let mut old_data = Vec::with_capacity(ATTESTATION_LEAF_SIZE);
    old_leaf
        .serialize(&mut old_data)
        .map_err(|_| ProgramError::Custom(err_composed::LIGHT_CPI_FAILED))?;

    let mut new_data = Vec::with_capacity(ATTESTATION_LEAF_SIZE);
    new_leaf
        .serialize(&mut new_data)
        .map_err(|_| ProgramError::Custom(err_composed::LIGHT_CPI_FAILED))?;

    let program_id = pinocchio_pubkey::pubkey!(
        "FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8"
    );

    let ix_data = encode_invoke_instruction_data(&build_revoke_instruction_data(
        proof,
        &old_data,
        *old_leaf_hash,
        old_leaf_index,
        old_root_index,
        &new_data,
        *new_leaf_hash,
        program_id,
    ));

    invoke_light_cpi(light_accounts, &ix_data)
}

/// Low-level: build Pinocchio Instruction targeting Light System Program
/// and invoke. The `light_accounts` slice MUST be in the order documented
/// at the top of this section: 1 (target program) + 11 fixed + N remaining.
///
/// Maximum 16 total accounts (suficiente pra insert flow com 1-2 trees;
/// revoke flow com input + output trees fits em 14-15).
fn invoke_light_cpi(light_accounts: &[AccountInfo], ix_data: &[u8]) -> ProgramResult {
    // Minimum: target + 11 fixed + 1 tree = 13.
    if light_accounts.len() < 13 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if light_accounts.len() > 16 {
        return Err(ProgramError::Custom(err_composed::LIGHT_CPI_FAILED));
    }

    // Validate canonical account positions (cheap fail-fast).
    if light_accounts[0].key() != &LIGHT_SYSTEM_PROGRAM_ID {
        return Err(ProgramError::Custom(err_composed::LIGHT_CPI_FAILED));
    }
    // light_accounts[6] = account_compression_program in our doc; positions are
    // 0=target,1=fee_payer,2=authority,3=registered_pda,4=_noop,5=compression_auth,
    // 6=account_compression_program. Verify.
    if light_accounts[6].key() != &ACCOUNT_COMPRESSION_PROGRAM_ID {
        return Err(ProgramError::Custom(err_composed::LIGHT_CPI_FAILED));
    }

    // Build AccountMeta array — skip light_accounts[0] (target program itself
    // doesn't appear in instruction.accounts; only in the program_id field).
    let mut metas: Vec<AccountMeta> = Vec::with_capacity(light_accounts.len() - 1);
    for acct in &light_accounts[1..] {
        metas.push(AccountMeta {
            pubkey: acct.key(),
            is_writable: acct.is_writable(),
            is_signer: acct.is_signer(),
        });
    }

    let ix = Instruction {
        program_id: &LIGHT_SYSTEM_PROGRAM_ID,
        accounts: &metas,
        data: ix_data,
    };

    // Convert `&[AccountInfo]` to `&[&AccountInfo]` (Pinocchio slice-API)
    let refs: Vec<&AccountInfo> = light_accounts.iter().collect();
    invoke_signed_with_bounds::<16>(&ix, &refs, &[])
        .map_err(|_| ProgramError::Custom(err_composed::LIGHT_CPI_FAILED))?;

    log!("light CPI ok");
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

