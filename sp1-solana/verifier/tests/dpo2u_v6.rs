//! DPO2U Sprint 4c regression test — verifies the committed compliance_threshold
//! Groth16 proof against the patched `verify_proof_v6` API.
//!
//! Fixtures are the exact bytes produced by `packages/zk-circuits/script` and
//! accepted by the on-chain `dpo2u-compliance-verifier` program deployed in
//! Sprint 4c (localnet program 9mM8YFGjVQNqdVHfidfhFd76nBnC1Cbj5bxi17AwQFuB).

use sp1_solana::{verify_proof_v6, GROTH16_VK_6_1_0_BYTES};

const DPO2U_VKEY_HASH: &str =
    "0x00a79ec59ae56e59d55164056cb52b261ac1bafd368d93deb43f153e5d93b414";

/// SP1 v6.1.0 recursion vk root — pinned from SP1VerifierGroth16.sol `VK_ROOT()`.
const SP1_V6_1_0_VK_ROOT: [u8; 32] = [
    0x00, 0x2f, 0x85, 0x0e, 0xe9, 0x98, 0x97, 0x4d, 0x6c, 0xc0, 0x0e, 0x50, 0xcd, 0x08, 0x14, 0xb0,
    0x98, 0xc0, 0x5b, 0xfa, 0xde, 0x46, 0x6d, 0x28, 0x57, 0x32, 0x40, 0xd0, 0x57, 0xf2, 0x53, 0x52,
];

#[test]
fn verifies_dpo2u_v6_proof() {
    let proof = std::fs::read("tests/fixtures/dpo2u_proof.bin").expect("proof.bin missing");
    let public_values =
        std::fs::read("tests/fixtures/dpo2u_public_values.bin").expect("public_values.bin missing");
    let vkey_hash = std::fs::read_to_string("tests/fixtures/dpo2u_vkey.hex")
        .expect("vkey.hex missing")
        .trim()
        .to_string();

    assert_eq!(vkey_hash, DPO2U_VKEY_HASH, "pinned vkey drifted");
    assert_eq!(proof.len(), 356, "SP1 v6 proof should be 356 bytes");
    assert_eq!(public_values.len(), 96, "PublicValuesStruct ABI-encoded = 96 bytes");

    verify_proof_v6(
        &proof,
        &public_values,
        &vkey_hash,
        GROTH16_VK_6_1_0_BYTES,
        &SP1_V6_1_0_VK_ROOT,
    )
    .expect("verify_proof_v6 failed — either format regression or VK mismatch");
}

#[test]
fn rejects_tampered_proof() {
    let mut proof = std::fs::read("tests/fixtures/dpo2u_proof.bin").unwrap();
    let public_values = std::fs::read("tests/fixtures/dpo2u_public_values.bin").unwrap();
    let vkey_hash = std::fs::read_to_string("tests/fixtures/dpo2u_vkey.hex")
        .unwrap()
        .trim()
        .to_string();

    // Flip a bit in the Groth16 proof payload (past the metadata envelope).
    proof[120] ^= 0x01;

    let result = verify_proof_v6(
        &proof,
        &public_values,
        &vkey_hash,
        GROTH16_VK_6_1_0_BYTES,
        &SP1_V6_1_0_VK_ROOT,
    );
    assert!(result.is_err(), "tampered proof must not verify");
}

#[test]
fn rejects_nonzero_exit_code() {
    let mut proof = std::fs::read("tests/fixtures/dpo2u_proof.bin").unwrap();
    let public_values = std::fs::read("tests/fixtures/dpo2u_public_values.bin").unwrap();
    let vkey_hash = std::fs::read_to_string("tests/fixtures/dpo2u_vkey.hex")
        .unwrap()
        .trim()
        .to_string();

    // Inject a non-zero exit code at bytes 4..36.
    proof[35] = 0x01;

    let result = verify_proof_v6(
        &proof,
        &public_values,
        &vkey_hash,
        GROTH16_VK_6_1_0_BYTES,
        &SP1_V6_1_0_VK_ROOT,
    );
    assert!(result.is_err(), "exit_code != 0 must reject");
}

#[test]
fn rejects_wrong_vk_root() {
    let proof = std::fs::read("tests/fixtures/dpo2u_proof.bin").unwrap();
    let public_values = std::fs::read("tests/fixtures/dpo2u_public_values.bin").unwrap();
    let vkey_hash = std::fs::read_to_string("tests/fixtures/dpo2u_vkey.hex")
        .unwrap()
        .trim()
        .to_string();

    let wrong_root = [0xFFu8; 32];

    let result = verify_proof_v6(
        &proof,
        &public_values,
        &vkey_hash,
        GROTH16_VK_6_1_0_BYTES,
        &wrong_root,
    );
    assert!(result.is_err(), "mismatched vk_root must reject");
}
