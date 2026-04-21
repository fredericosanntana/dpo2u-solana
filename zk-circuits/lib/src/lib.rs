//! DPO2U compliance_threshold circuit — library crate.
//!
//! Exposes the public values structure shared between `program/` (the zkVM
//! RISC-V binary) and `script/` (the prover CLI + verifier).
//!
//! Statement proven (zero-knowledge):
//!   "There exists a private `score ∈ [0, 100]` such that `score >= threshold`
//!    for a given (public) `threshold` and a (public) `subject_commitment`."
//!
//! The verifier sees `threshold` + `subject_commitment` + `meets_threshold`,
//! never the `score` itself.

use alloy_sol_types::sol;

sol! {
    /// Public values committed by the zkVM program. ABI-encoded so both
    /// Solana (via sp1-solana verifier) and EVM chains can decode natively.
    #[derive(Debug)]
    struct PublicValuesStruct {
        uint32 threshold;
        bytes32 subject_commitment;
        bool meets_threshold;
    }
}

/// Constant-time-ish score check inside the circuit. Sprint 4c will add
/// range constraints (0 <= score <= 100) and bind the commitment to a
/// pre-image preimage oracle proving the score was measured by a trusted
/// DPO tool (not arbitrary).
pub fn check_compliance_threshold(score: u32, threshold: u32) -> bool {
    score >= threshold
}
