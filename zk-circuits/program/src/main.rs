//! DPO2U compliance_threshold circuit — zkVM program.
//!
//! Runs inside SP1's RISC-V zkVM. Reads the private score, reads public
//! threshold + subject_commitment, asserts `score >= threshold` and commits
//! public values. Verifier sees only threshold + commitment + boolean result.
//!
//! Sprint 4b: proof-of-concept. Sprint 4c adds range checks + commitment
//! pre-image binding.

#![no_main]

sp1_zkvm::entrypoint!(main);

use alloy_sol_types::SolType;
use dpo2u_zk_lib::{check_compliance_threshold, PublicValuesStruct};

pub fn main() {
    // Private input: the score (never revealed).
    let score: u32 = sp1_zkvm::io::read::<u32>();

    // Public inputs: threshold (policy config) + subject_commitment (hash of
    // the subject identifier — CNPJ or DID). Both get committed to the public
    // values so the verifier can reconstruct without seeing the score.
    let threshold: u32 = sp1_zkvm::io::read::<u32>();
    let subject_commitment: [u8; 32] = sp1_zkvm::io::read::<[u8; 32]>();

    let meets_threshold = check_compliance_threshold(score, threshold);

    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct {
        threshold,
        subject_commitment: subject_commitment.into(),
        meets_threshold,
    });

    sp1_zkvm::io::commit_slice(&bytes);
}
