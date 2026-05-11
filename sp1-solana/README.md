# `sp1-solana` — DPO2U fork (SP1 v6 patch)

This crate verifies Groth16 proofs generated with SP1, leveraging Solana's
BN254 precompiles for efficient cryptographic operations.

> [!NOTE]
> This is DPO2U's fork of [`succinctlabs/sp1-solana`](https://github.com/succinctlabs/sp1-solana@4181cae),
> extending the upstream v5-only verifier with an SP1 **v6** entry point
> (`verify_proof_v6`). The upstream `verify_proof` remains untouched for v5
> backward compatibility. Fork change is ~120 LOC; an upstream PR is planned.

> [!CAUTION]
> This repository is not audited for production use.

## Repository Overview

- [`verifier/`](verifier) — the `sp1-solana` library crate. `verify_proof_v6`
  parses the SP1 v6 proof envelope (`exitCode + vkRoot + nonce`) and runs the
  pairing check against 5 public inputs.
- [`verifier/tests/dpo2u_v6.rs`](verifier/tests/dpo2u_v6.rs) — regression
  tests: positive verification + 3 rejection modes (tampered proof, non-zero
  exit code, wrong vk_root). Fixtures committed in `verifier/tests/fixtures/`.
- [`example/program/`](example/program) — `dpo2u-compliance-verifier` — the
  on-chain Solana program that wraps `verify_proof_v6` with the DPO2U
  `compliance_threshold` circuit's pinned program vkey and SP1 v6.1.0 vk_root.
- [`example/script/`](example/script) — `dpo2u-driver` — a CLI that loads a
  committed DPO2U proof and submits it to the on-chain verifier via
  `solana-program-test`. No SP1 prover install required — judges run
  `cargo run -p dpo2u-driver --release -- --verbose` and see the pairing
  succeed in ~30 seconds.

## What `verify_proof_v6` added

| | v5 (`verify_proof`) | v6 (`verify_proof_v6`) |
|---|---|---|
| Proof envelope | 4 B selector | 4 B selector + 32 B exitCode + 32 B vkRoot + 32 B nonce |
| Public inputs | 2 (vkey_hash, committed_values_digest) | 5 (+ exitCode, vkRoot, nonce) |
| vkRoot pinning | — | Required (constant per SP1 version) |
| Backward compatibility | — | `verify_proof` still exported unchanged |

Public inputs supplied to the pairing (v6):

```
inputs[0] = programVKey           // 31-byte DPO2U vkey hash, left-padded
inputs[1] = publicValuesDigest    // sha256(public_values) & (2^253 - 1)
inputs[2] = exitCode              // must be 0 (zkVM halted successfully)
inputs[3] = vkRoot                // pinned constant for SP1 v6.1.0
inputs[4] = nonce                 // freely chosen by prover
```

The 31-byte vkey_hash truncation is load-bearing — BN254's scalar field is
~254 bits, so a full 32-byte hash would alias on values above the prime.
The SP1 SDK guarantees the first byte is zero, making the drop safe.

## Running the DPO2U driver

The driver loads the committed DPO2U compliance proof (score ≥ threshold,
subject=`did:test:company:acme`, threshold=70) and verifies it on
`solana-program-test`:

```shell
# From this directory
cargo run --release -p dpo2u-driver -- --verbose
```

Expected output:

```
┌─ DPO2U compliance proof ──────────────────────────────────────────┐
│ threshold           : 70                                           │
│ subject_commitment  : 0x0913644c8b396ebcee2b280e10247556a2f65c4a8e │
│ meets_threshold     : true                                         │
│ proof size          : 356 bytes                                    │
└───────────────────────────────────────────────────────────────────┘
dpo2u compliance v6 proof verified: 96 public-input bytes
✓ on-chain verification succeeded — pairing check passed on Solana runtime
```

The on-chain verifier consumes ~156k CU for the pairing. The driver bumps
the compute budget to 250k to leave safety margin for instruction overhead.

## How `dpo2u-compliance-verifier` uses the library

```rust
use sp1_solana::{verify_proof_v6, GROTH16_VK_6_1_0_BYTES};

const DPO2U_COMPLIANCE_VKEY_HASH: &str =
    "0x00a79ec59ae56e59d55164056cb52b261ac1bafd368d93deb43f153e5d93b414";

/// SP1 v6.1.0 recursion vk root — pinned from SP1VerifierGroth16.sol `VK_ROOT()`.
const SP1_V6_1_0_VK_ROOT: [u8; 32] = [
    0x00, 0x2f, 0x85, 0x0e, /* ... */
];

#[derive(BorshDeserialize, BorshSerialize)]
pub struct SP1Groth16Proof {
    pub proof: Vec<u8>,
    pub sp1_public_inputs: Vec<u8>,
}

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let groth16_proof = SP1Groth16Proof::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    verify_proof_v6(
        &groth16_proof.proof,
        &groth16_proof.sp1_public_inputs,
        DPO2U_COMPLIANCE_VKEY_HASH,
        sp1_solana::GROTH16_VK_6_1_0_BYTES,
        &SP1_V6_1_0_VK_ROOT,
    )
    .map_err(|_| ProgramError::InvalidInstructionData)?;

    msg!(
        "dpo2u compliance v6 proof verified: {} public-input bytes",
        groth16_proof.sp1_public_inputs.len()
    );
    Ok(())
}
```

> [!NOTE]
> In this example, proof + public values are passed directly in transaction
> data. Groth16 proofs are 356 B and the DPO2U public values 96 B — total
> ~450 B fits comfortably in the 1232 B tx data limit. Larger circuits may
> need lookup tables — see [this article](https://solana.com/developers/courses/program-optimization/lookup-tables).

## Requirements

- Rust 1.95+
- Anza Solana CLI 3.1+

```shell
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.13/install)"
```

## Deploying the verifier program

```shell
cd example/program
cargo build-sbf --sbf-out-dir ../target/deploy
solana config set -ud   # devnet
solana program deploy --program-id ../target/deploy/dpo2u_compliance_verifier-keypair.json \
  ../target/deploy/dpo2u_compliance_verifier.so
```

The SP1 v6 verifier consumes ~280K CU at deploy time (above the 200K
default). Clients invoking `process_instruction` must set a compute budget
of ≥200K (the driver uses 250K to include margin).

## Installation (as a library)

Add to your `Cargo.toml`:

```toml
[dependencies]
sp1-solana = { git = "https://github.com/fredericosanntana/dpo2u-solana", branch = "main" }
```

Or, once the upstream PR lands:

```toml
[dependencies]
sp1-solana = "0.3"  # v6 support
```

## Acknowledgements

Uses [`groth16-solana`](https://github.com/Lightprotocol/groth16-solana/)
from Light Protocol Labs for Groth16 verification and
[`ark-bn254`](https://github.com/arkworks-rs/algebra) for elliptic curve
operations. The v6 patch is built on top of the upstream SP1 v5 verifier —
all credit to Succinct Labs for the original crate.
