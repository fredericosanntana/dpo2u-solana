//! Print the verifying key hash for the compliance_threshold circuit.
//! Used by the on-chain verifier (sp1-solana) to identify which circuit a
//! proof was generated for.

use sp1_sdk::{blocking::MockProver, blocking::Prover, include_elf, Elf, HashableKey};

const COMPLIANCE_ELF: Elf = include_elf!("compliance-threshold-program");

fn main() {
    let prover = MockProver::new();
    let pk = prover.setup(COMPLIANCE_ELF).expect("setup");
    println!("vkey_bytes32: {}", pk.verifying_key().bytes32());
}
