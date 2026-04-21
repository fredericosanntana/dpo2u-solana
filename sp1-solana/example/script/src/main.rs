//! DPO2U driver — loads a committed SP1 v6 Groth16 proof and submits it to the
//! `dpo2u-compliance-verifier` on-chain program, running inside
//! `solana-program-test`.
//!
//! This is the Rust-only reproducibility path for hackathon judges: no SP1
//! prover install, no Solana test validator — just `cargo run` from a fresh
//! checkout, ~30 seconds to finish, and you see the pairing check consume
//! ~156k CU on a real Solana runtime.
//!
//! Fixtures default to `sp1-solana/verifier/tests/fixtures/dpo2u_*` (checked
//! in at repo root, byte-identical with `zk-circuits/proofs/`).

use std::path::PathBuf;

use borsh::BorshDeserialize;
use clap::Parser;
use dpo2u_compliance_verifier::SP1Groth16Proof;
use solana_program_test::{processor, ProgramTest};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    instruction::Instruction,
    pubkey::Pubkey,
    signer::Signer,
    transaction::Transaction,
};

// Pinned by the compliance-registry program — must match the localnet/devnet
// deployment address of dpo2u-compliance-verifier.
const VERIFIER_PROGRAM_ID_STR: &str = "9mM8YFGjVQNqdVHfidfhFd76nBnC1Cbj5bxi17AwQFuB";

#[derive(Parser, Debug)]
#[command(
    name = "dpo2u-driver",
    about = "Submit a committed DPO2U SP1 v6 Groth16 proof to the on-chain verifier"
)]
struct Args {
    /// Path to the 356-byte SP1 v6 proof bytes. Default resolves relative to
    /// the sp1-solana workspace root (where cargo run is usually invoked).
    #[arg(long, default_value = "verifier/tests/fixtures/dpo2u_proof.bin")]
    proof: PathBuf,
    /// Path to the 96-byte ABI-encoded PublicValuesStruct.
    #[arg(long = "public-values", default_value = "verifier/tests/fixtures/dpo2u_public_values.bin")]
    public_values: PathBuf,
    /// Print extra log lines (program logs, CU consumed).
    #[arg(long, short)]
    verbose: bool,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args = Args::parse();

    let proof = std::fs::read(&args.proof)
        .unwrap_or_else(|e| panic!("could not read proof at {}: {e}", args.proof.display()));
    let public_values = std::fs::read(&args.public_values)
        .unwrap_or_else(|e| panic!("could not read public values at {}: {e}", args.public_values.display()));

    if proof.len() != 356 {
        eprintln!("⚠ expected 356-byte SP1 v6 proof, got {}", proof.len());
        std::process::exit(2);
    }
    if public_values.len() != 96 {
        eprintln!("⚠ expected 96-byte PublicValuesStruct, got {}", public_values.len());
        std::process::exit(2);
    }

    let threshold = u32::from_be_bytes(public_values[28..32].try_into().unwrap());
    let subject_commitment_hex = hex_encode(&public_values[32..64]);
    let meets_threshold = public_values[95] != 0;

    println!("┌─ DPO2U compliance proof ──────────────────────────────────────────┐");
    println!("│ threshold           : {:<44} │", threshold);
    println!("│ subject_commitment  : 0x{:<42.42} │", subject_commitment_hex);
    println!("│ meets_threshold     : {:<44} │", meets_threshold);
    println!("│ proof size          : {} bytes                                    │", proof.len());
    println!("└───────────────────────────────────────────────────────────────────┘");

    let envelope = SP1Groth16Proof {
        proof,
        sp1_public_inputs: public_values,
    };
    let ix_data = borsh::to_vec(&envelope).expect("Borsh serialize SP1Groth16Proof");

    // Catches accidental schema drift between this crate and the verifier's.
    let _round_trip =
        SP1Groth16Proof::try_from_slice(&ix_data).expect("Borsh round-trip sanity");

    let program_id: Pubkey = VERIFIER_PROGRAM_ID_STR
        .parse()
        .expect("valid base58 program id");

    let program_test = ProgramTest::new(
        "dpo2u_compliance_verifier",
        program_id,
        processor!(dpo2u_compliance_verifier::process_instruction),
    );
    let (banks_client, payer, recent_blockhash) = program_test.start().await;

    // Pairing check + ABI-decode overhead; the default 200k is tight.
    let compute_ix = ComputeBudgetInstruction::set_compute_unit_limit(250_000);
    let verify_ix = Instruction::new_with_borsh(program_id, &envelope, vec![]);

    let mut tx = Transaction::new_with_payer(&[compute_ix, verify_ix], Some(&payer.pubkey()));
    tx.sign(&[&payer], recent_blockhash);

    let sim = banks_client
        .simulate_transaction(tx.clone())
        .await
        .expect("simulate RPC");

    if args.verbose {
        if let Some(details) = &sim.simulation_details {
            println!("compute units consumed (sim): {}", details.units_consumed);
            if !details.logs.is_empty() {
                println!("-- program logs --");
                for line in &details.logs {
                    println!("  {line}");
                }
            }
        }
    }

    match banks_client.process_transaction(tx).await {
        Ok(()) => {
            println!("✓ on-chain verification succeeded — pairing check passed on Solana runtime");
        }
        Err(e) => {
            eprintln!("✗ on-chain verification failed: {e}");
            std::process::exit(1);
        }
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(&mut s, "{:02x}", b);
    }
    s
}
