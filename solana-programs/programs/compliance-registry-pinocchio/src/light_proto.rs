//! Light Protocol — types and instruction encoding for raw CPI.
//!
//! Substitui a dependência de `light-system-program-anchor` por structs
//! Borsh-derived inline. Layout válido pra Light System Program v0.x
//! (program ID `SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7`).
//!
//! IMPORTANTE: estas structs são reproductions do código upstream
//! (https://github.com/Lightprotocol/light-protocol). Antes de mainnet
//! deploy, validar empiricamente contra devnet real:
//!
//!   1. Submeter uma `submit_verified_compressed` tx em devnet
//!   2. Confirmar que Photon Indexer reconstrói o leaf
//!   3. Bater leaf hash com o `compute_leaf_hash` do compliance-registry-pinocchio
//!
//! Se layout do upstream mudar (tipico em 0.x → 1.0 transitions), regenerar
//! a partir do IDL canonical em `light-system-program-anchor` crate.
//!
//! v0.x layout reference (subject to upstream evolution):
//!   - InstructionDataInvoke: discriminator [49,69,143,...] (Anchor "invoke")
//!     + Borsh struct
//!   - OutputCompressedAccountWithPackedContext: leaf + tree_index
//!   - PackedCompressedAccountWithMerkleContext: leaf + merkle_proof_context
//!
//! Pinocchio integration constraints:
//!   - extern alloc Vec/String OK (já em scope no lib.rs)
//!   - No std collections (no HashMap, no Box<dyn>)
//!   - Manual instruction encoding (sem Anchor #[derive(InstructionData)])

extern crate alloc;

use alloc::vec::Vec;
use borsh::{BorshDeserialize, BorshSerialize};
use pinocchio::pubkey::Pubkey;

/// Light System Program ID (v0.x mainnet + devnet).
pub const LIGHT_SYSTEM_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");

/// Discriminator pinned do instruction `invoke_cpi` no Light System Program.
///
/// **Source-of-truth**: upstream `program-libs/compressed-account/src/discriminators.rs`:
///   `pub const DISCRIMINATOR_INVOKE: [u8; 8] = [26, 16, 169, 7, 21, 202, 242, 25];`
///   `pub const DISCRIMINATOR_INVOKE_CPI: [u8; 8] = [49, 212, 191, 129, 39, 194, 43, 196];`
///
/// IMPORTANT: usamos `INVOKE_CPI` (não `INVOKE`) porque o compliance-registry-pinocchio
/// invoca o Light System Program via CPI (requer `invoking_program` account na lista).
/// O `Invoke` discriminator é só pra calls externas diretas do cliente (e.g. wallet).
///
/// Verificado contra commit upstream main em 2026-05-08.
///
/// **Pre-mainnet caveat**: o compliance-registry-pinocchio precisa estar
/// REGISTRADO no Light account-compression program antes de fazer CPI bem-sucedido.
/// Registration é uma operação one-time on-chain; ver
/// `programs/account-compression/src/instructions/register_program.rs`.
pub const LIGHT_INVOKE_CPI_DISCRIMINATOR: [u8; 8] = [49, 212, 191, 129, 39, 194, 43, 196];

/// Account compression program ID (from upstream `programs/account-compression/src/lib.rs`).
pub const ACCOUNT_COMPRESSION_PROGRAM_ID: Pubkey =
    pinocchio_pubkey::pubkey!("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");

// =============================================================================
// CompressedProof — Groth16 proof serialized as 3 group elements
// =============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct CompressedProof {
    pub a: [u8; 32],
    pub b: [u8; 64],
    pub c: [u8; 32],
}

// =============================================================================
// CompressedAccount and helpers
// =============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct CompressedAccountData {
    /// 8-byte program-defined discriminator (we use a constant pra DPO2U leaves).
    pub discriminator: [u8; 8],
    /// Raw data (the 252-byte AttestationLeaf serialized via Borsh).
    pub data: Vec<u8>,
    /// SHA-256 hash of `data` (Light verifies on-chain).
    pub data_hash: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct CompressedAccount {
    /// Owner program (deve ser igual ao programa que está fazendo CPI ao Light).
    pub owner: Pubkey,
    /// Lamports do leaf (compress flow). Pra DPO2U, sempre 0 — sem custódia de SOL.
    pub lamports: u64,
    /// Address opcional (Light Protocol Address Tree). Pra leaves anonymous,
    /// None — pra leaves com address único (anti-collision), Some.
    pub address: Option<[u8; 32]>,
    /// Data + hash (sempre Some pro DPO2U — leaves carregam AttestationLeaf).
    pub data: Option<CompressedAccountData>,
}

// =============================================================================
// Output / Input contexts (v0.x packed format)
// =============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct OutputCompressedAccountWithPackedContext {
    pub compressed_account: CompressedAccount,
    /// Index into the `remaining_accounts` array do CPI pra apontar pra
    /// state tree onde inserir o leaf. Pinocchio precisa colocar o tree
    /// account na posição correspondente.
    pub merkle_tree_index: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct PackedMerkleContext {
    pub merkle_tree_pubkey_index: u8,
    pub queue_pubkey_index: u8,
    pub leaf_index: u32,
    /// Se true, usa o leaf_index pra prove (não Merkle proof). Pra DPO2U
    /// revoke flow normal: false (validity proof via Photon).
    pub prove_by_index: bool,
}

/// Upstream type name in `program-libs/compressed-account/src/compressed_account.rs`.
/// Wraps a CompressedAccount + merkle context + root_index pra spend operations.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct PackedCompressedAccountWithMerkleContext {
    pub compressed_account: CompressedAccount,
    pub merkle_context: PackedMerkleContext,
    /// Root index na changelog buffer da CMT — Photon supplies em getValidityProof.
    pub root_index: u16,
    /// Pra leaves que estão sendo READ-ONLY visited (não consumidos).
    /// Sempre false pra DPO2U revoke flow.
    pub read_only: bool,
}

// =============================================================================
// NewAddressParamsPacked (Light Address Tree alloc)
// =============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct NewAddressParamsPacked {
    pub seed: [u8; 32],
    pub address_queue_account_index: u8,
    pub address_merkle_tree_account_index: u8,
    pub address_merkle_tree_root_index: u16,
}

// =============================================================================
// InstructionDataInvoke — root struct for Light System Program::invoke
// =============================================================================

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct InstructionDataInvoke {
    pub proof: Option<CompressedProof>,
    pub input_compressed_accounts_with_merkle_context:
        Vec<PackedCompressedAccountWithMerkleContext>,
    pub output_compressed_accounts: Vec<OutputCompressedAccountWithPackedContext>,
    pub relay_fee: Option<u64>,
    pub new_address_params: Vec<NewAddressParamsPacked>,
    pub compress_or_decompress_lamports: Option<u64>,
    pub is_compress: bool,
}

// =============================================================================
// Builders — high-level helpers pros 2 fluxos DPO2U
// =============================================================================

/// 8-byte discriminator pro CompressedAccountData de DPO2U leaves.
/// Permite que Photon distinga leaves DPO2U de outros programas que
/// usam o mesmo state tree. Constante pinned — mudar quebra leaf hashes.
pub const DPO2U_LEAF_DISCRIMINATOR: [u8; 8] = *b"DPO2ULF1"; // "DPO2U Leaf v1"

/// Builds InstructionDataInvoke for inserting a single new leaf.
///
/// Layout: 1 output (the new leaf), 0 inputs, no proof needed (insert).
/// `merkle_tree_index = 0` aponta pra primeiro tree account no remaining_accounts.
pub fn build_insert_instruction_data(
    leaf_data: &[u8],     // 252-byte AttestationLeaf serialized
    leaf_data_hash: [u8; 32],
    owner: Pubkey,
) -> InstructionDataInvoke {
    let output = OutputCompressedAccountWithPackedContext {
        compressed_account: CompressedAccount {
            owner,
            lamports: 0,
            address: None,
            data: Some(CompressedAccountData {
                discriminator: DPO2U_LEAF_DISCRIMINATOR,
                data: leaf_data.to_vec(),
                data_hash: leaf_data_hash,
            }),
        },
        merkle_tree_index: 0,
    };

    InstructionDataInvoke {
        proof: None,
        input_compressed_accounts_with_merkle_context: Vec::new(),
        output_compressed_accounts: alloc::vec![output],
        relay_fee: None,
        new_address_params: Vec::new(),
        compress_or_decompress_lamports: None,
        is_compress: false,
    }
}

/// Builds InstructionDataInvoke pro revoke flow (UTXO-style):
///   - 1 input (old leaf nullified)
///   - 1 output (new leaf with status=Revoked)
///   - validity proof (Photon supplies)
pub fn build_revoke_instruction_data(
    proof: CompressedProof,
    old_leaf_data: &[u8],
    old_leaf_data_hash: [u8; 32],
    old_leaf_index: u32,
    old_root_index: u16,
    new_leaf_data: &[u8],
    new_leaf_data_hash: [u8; 32],
    owner: Pubkey,
) -> InstructionDataInvoke {
    let input = PackedCompressedAccountWithMerkleContext {
        compressed_account: CompressedAccount {
            owner,
            lamports: 0,
            address: None,
            data: Some(CompressedAccountData {
                discriminator: DPO2U_LEAF_DISCRIMINATOR,
                data: old_leaf_data.to_vec(),
                data_hash: old_leaf_data_hash,
            }),
        },
        merkle_context: PackedMerkleContext {
            merkle_tree_pubkey_index: 0,
            queue_pubkey_index: 1,
            leaf_index: old_leaf_index,
            prove_by_index: false,
        },
        root_index: old_root_index,
        read_only: false,
    };

    let output = OutputCompressedAccountWithPackedContext {
        compressed_account: CompressedAccount {
            owner,
            lamports: 0,
            address: None,
            data: Some(CompressedAccountData {
                discriminator: DPO2U_LEAF_DISCRIMINATOR,
                data: new_leaf_data.to_vec(),
                data_hash: new_leaf_data_hash,
            }),
        },
        merkle_tree_index: 0,
    };

    InstructionDataInvoke {
        proof: Some(proof),
        input_compressed_accounts_with_merkle_context: alloc::vec![input],
        output_compressed_accounts: alloc::vec![output],
        relay_fee: None,
        new_address_params: Vec::new(),
        compress_or_decompress_lamports: None,
        is_compress: false,
    }
}

/// Encode the full instruction data: discriminator + 4-byte Vec<u8> length
/// prefix + Borsh-serialized payload.
///
/// Wire format (verified em upstream `programs/system/src/lib.rs::invoke`):
///   bytes[0..8]    = LIGHT_INVOKE_CPI_DISCRIMINATOR
///   bytes[8..12]   = u32 LE length of the borsh payload
///   bytes[12..]    = borsh::serialize(&InstructionDataInvoke)
///
/// O Light System Program faz `split_at(8)` pra separar discriminator,
/// depois `instruction_data[4..]` pra remover Vec prefix, então deserializa
/// o resto via Borsh zero-copy. Sem o prefix, deserialization falha.
pub fn encode_invoke_instruction_data(data: &InstructionDataInvoke) -> Vec<u8> {
    // Borsh-serialize the payload first to know its length
    let mut payload = Vec::with_capacity(512);
    data.serialize(&mut payload)
        .expect("borsh serialize of InstructionDataInvoke never fails");

    let mut buf = Vec::with_capacity(8 + 4 + payload.len());
    buf.extend_from_slice(&LIGHT_INVOKE_CPI_DISCRIMINATOR);
    buf.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    buf.extend_from_slice(&payload);
    buf
}
