//! DPO2U compliance_threshold — execute OR generate Groth16 proof.

use alloy_sol_types::SolType;
use clap::Parser;
use dpo2u_zk_lib::PublicValuesStruct;
use sp1_sdk::{blocking::{Prover, ProverClient, ProveRequest}, include_elf, Elf, HashableKey, ProvingKey, SP1Stdin};

const COMPLIANCE_ELF: Elf = include_elf!("compliance-threshold-program");

#[derive(Parser, Debug)]
struct Args {
    #[arg(long)]
    execute: bool,
    #[arg(long)]
    prove: bool,
    #[arg(long, default_value = "85")]
    score: u32,
    #[arg(long, default_value = "70")]
    threshold: u32,
    #[arg(long, default_value = "did:test:company:acme")]
    subject: String,
    #[arg(long, default_value = "./proof.bin")]
    out_proof: String,
    #[arg(long, default_value = "./public_values.bin")]
    out_public: String,
    #[arg(long, default_value = "./vkey.hex")]
    out_vkey: String,
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let args = Args::parse();
    if args.execute == args.prove {
        eprintln!("pass exactly one of --execute or --prove");
        std::process::exit(1);
    }

    let subject_commitment: [u8; 32] = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(args.subject.as_bytes());
        h.finalize().into()
    };

    let mut stdin = SP1Stdin::new();
    stdin.write(&args.score);
    stdin.write(&args.threshold);
    stdin.write(&subject_commitment);

    let client = ProverClient::from_env();

    if args.execute {
        let (output, report) = client
            .execute(COMPLIANCE_ELF, stdin)
            .run()
            .expect("execute failed");
        let decoded = PublicValuesStruct::abi_decode(output.as_slice()).expect("decode");
        println!("-- compliance_threshold executed in zkVM --");
        println!("  score (private, HIDDEN): {}", args.score);
        println!("  threshold (public):      {}", decoded.threshold);
        println!("  commitment (public):     0x{}", hex::encode(decoded.subject_commitment.as_slice()));
        println!("  meets_threshold:         {}", decoded.meets_threshold);
        println!("  zkVM cycles:             {}", report.total_instruction_count());
    } else {
        println!("generating Groth16 proof (slow; ~5-15min first run)...");
        let pk = client.setup(COMPLIANCE_ELF).expect("setup");
        let vk = pk.verifying_key().clone();
        let proof = client
            .prove(&pk, stdin)
            .groth16()
            .run()
            .expect("prove failed");
        client.verify(&proof, &vk, None).expect("verify failed");
        let decoded =
            PublicValuesStruct::abi_decode(proof.public_values.as_slice()).expect("decode");
        println!("-- compliance_threshold PROOF --");
        println!("  threshold:       {}", decoded.threshold);
        println!("  commitment:      0x{}", hex::encode(decoded.subject_commitment.as_slice()));
        println!("  meets_threshold: {}", decoded.meets_threshold);
        let vk_hex = vk.bytes32();
        println!("  vkey:            {}", vk_hex);
        let proof_bytes = proof.bytes();
        println!("  proof_bytes:     {} bytes", proof_bytes.len());
        std::fs::write(&args.out_proof, &proof_bytes).expect("write proof");
        std::fs::write(&args.out_public, proof.public_values.as_slice()).expect("write pv");
        std::fs::write(&args.out_vkey, vk_hex.as_bytes()).expect("write vkey");
        println!("  -> {}, {}, {}", args.out_proof, args.out_public, args.out_vkey);
    }
}
