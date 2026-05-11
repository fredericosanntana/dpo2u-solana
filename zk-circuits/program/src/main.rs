#![no_main]

sp1_zkvm::entrypoint!(main);

use alloy_sol_types::SolType;
use dpo2u_zk_lib::PublicValuesStruct;

pub fn main() {
    // Private input: The raw evaluation evidence that produces the bitmap.
    // In v0.1, the inspector passes the verified bitmap directly as a private input.
    // (In future iterations, the VM will parse the raw SBOM itself off-chain).
    let predicates_bitmap: u32 = sp1_zkvm::io::read::<u32>();

    // Public inputs: Repository Commit Hash and Agent Pubkey
    let commit_hash: [u8; 32] = sp1_zkvm::io::read::<[u8; 32]>();
    let agent_pubkey: [u8; 32] = sp1_zkvm::io::read::<[u8; 32]>();

    // Commit the public values
    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct {
        commit_hash: commit_hash.into(),
        agent_pubkey: agent_pubkey.into(),
        predicates_bitmap,
    });

    sp1_zkvm::io::commit_slice(&bytes);
}
