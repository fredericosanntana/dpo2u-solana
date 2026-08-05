//! DPO2U compliance_threshold on-chain SP1 v6 Groth16 verifier.
//!
//! Accepts a serialized SP1 v6 Groth16 proof + public inputs, verifies it
//! against the pinned DPO2U program verification key, the SP1 v6.1.0 Groth16
//! verification key, and the SP1 v6.1.0 recursion vk_root constant.
//!
//! Public inputs are alloy-sol-types ABI-encoded `PublicValuesStruct` from
//! `dpo2u-zk-lib` (threshold: uint32, subject_commitment: bytes32,
//! meets_threshold: bool).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, program_error::ProgramError,
    pubkey::Pubkey,
};
use sp1_solana::verify_proof_v6;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

const DPO2U_COMPLIANCE_VKEY_HASH: &str =
    "0x00a79ec59ae56e59d55164056cb52b261ac1bafd368d93deb43f153e5d93b414";

/// SP1 v6.1.0 recursion vk root — pinned from SP1VerifierGroth16.sol `VK_ROOT()`.
const SP1_V6_1_0_VK_ROOT: [u8; 32] = [
    0x00, 0x2f, 0x85, 0x0e, 0xe9, 0x98, 0x97, 0x4d, 0x6c, 0xc0, 0x0e, 0x50, 0xcd, 0x08, 0x14, 0xb0,
    0x98, 0xc0, 0x5b, 0xfa, 0xde, 0x46, 0x6d, 0x28, 0x57, 0x32, 0x40, 0xd0, 0x57, 0xf2, 0x53, 0x52,
];

#[derive(BorshDeserialize, BorshSerialize)]
pub struct SP1Groth16Proof {
    pub proof: Vec<u8>,
    pub sp1_public_inputs: Vec<u8>,
}

/// Hex-encode bytes como "0x…" (sem dep extra).
fn vkey_to_hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(2 + b.len() * 2);
    s.push('0');
    s.push('x');
    for &x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 0x0f) as usize] as char);
    }
    s
}

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Lê os 2 Vec do SP1Groth16Proof por cursor (deixa bytes trailing, se houver).
    let mut cursor: &[u8] = instruction_data;
    let groth16_proof = SP1Groth16Proof::deserialize(&mut cursor)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // vkey_hash GENÉRICO: 32 bytes trailing → usa-os (ex.: circuito de dispensação);
    // ausente → fallback ao vkey da atestação (backward-compat com o selector 0x01).
    let vkey_hash: String = if cursor.len() >= 32 {
        vkey_to_hex(&cursor[..32])
    } else {
        DPO2U_COMPLIANCE_VKEY_HASH.into()
    };

    let vk = sp1_solana::GROTH16_VK_6_1_0_BYTES;

    verify_proof_v6(
        &groth16_proof.proof,
        &groth16_proof.sp1_public_inputs,
        &vkey_hash,
        vk,
        &SP1_V6_1_0_VK_ROOT,
    )
    .map_err(|_| ProgramError::InvalidInstructionData)?;

    msg!(
        "sp1 v6 proof verified: {} public-input bytes, vkey {}",
        groth16_proof.sp1_public_inputs.len(),
        &vkey_hash[..10]
    );

    Ok(())
}
