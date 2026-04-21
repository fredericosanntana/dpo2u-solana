# DPO2U compliance_threshold — Sprint 4c proof artifacts

## Contents

| File | Size | Description |
|---|---|---|
| `proof.bin` | 356 B | SP1 Groth16 proof (BN254, uncompressed + gnark commitment suffix) |
| `public_values.bin` | 96 B | ABI-encoded `PublicValuesStruct`: uint32 threshold + bytes32 subject_commitment + bool meets_threshold |
| `vkey.hex` | 66 B | Program verification key hash: `0x00a79ec59ae56e59d55164056cb52b261ac1bafd368d93deb43f153e5d93b414` |

## Reproduction

```bash
cd packages/zk-circuits
cargo build --release --bin prove
./target/release/prove --prove \
  --score 85 --threshold 70 \
  --subject "did:test:company:acme" \
  --out-proof proofs/proof.bin \
  --out-public proofs/public_values.bin \
  --out-vkey proofs/vkey.hex
```

First-run cost: ~25 min + 26 GB peak memory (STARK + Groth16 wrap). Requires 16+ GB swap on a 32 GB VPS — see `/etc/fstab` for DPO2U swap config.

## On-chain verification (Sprint 4c status — FULL PASS)

| Component | Status |
|---|---|
| SP1 prover (`target/release/prove`) | ✅ Produces valid SP1 v6.1.0 Groth16 proof (356 B) |
| sp1-solana verifier (forked + patched for v6) | ✅ Program ID `5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW` (localnet) |
| `SolanaDriver.generateZKProof` → real SP1 proof | ✅ Spawns subprocess, reads proof/public_values/vkey |
| `SolanaDriver.verifyZKProof` → on-chain tx | ✅ `valid:true _mock:false` — pairing succeeds on-chain |

### SP1 v6 proof format (decoded from Solidity reference)

The 356-byte proof layout is **not** gnark commitments — it's SP1 v6 metadata ABI-encoded between the selector and the proof proper, mirroring `SP1VerifierGroth16.sol::verifyProof`:

```
bytes 0..4     selector = sha256(GROTH16_VK_6_1_0)[..4] = 0x4388a21c
bytes 4..36    exitCode (u256, must be 0)
bytes 36..68   vkRoot   (u256, must equal SP1 v6.1.0 VK_ROOT constant)
bytes 68..100  nonce    (u256, freely committed)
bytes 100..356 Groth16 proof: pi_a (64) + pi_b (128) + pi_c (64)
```

Public inputs for the Groth16 pairing are **5** (v5 had 2):

```
inputs[0] = programVKey           (31-byte DPO2U vkey hash, left-padded)
inputs[1] = publicValuesDigest    (sha256(public_values) & (2^253 - 1))
inputs[2] = exitCode              (must be 0)
inputs[3] = vkRoot                (pinned constant for SP1 version)
inputs[4] = nonce                 (freely chosen by prover)
```

### Patch summary

`packages/sp1-solana/` is a fork of `succinctlabs/sp1-solana@4181cae` with:

- `verifier/vk/v6.1.0/groth16_vk.bin` — new VK bytes (492 B vs v5 396 B)
- `verifier/src/lib.rs::GROTH16_VK_6_1_0_BYTES` — public constant
- `verifier/src/lib.rs::verify_proof_v6` — new API that parses 96 B metadata, validates exitCode/vkRoot, builds 5 public inputs, runs pairing
- `verifier/src/utils.rs::load_public_inputs_v6_from_bytes` — extends PublicInputs to N=5
- `verifier/src/utils.rs::Error::{InvalidExitCode, InvalidVkRoot}` — new error variants

Upstream PR candidate: the change is minimal (~120 LOC) and backward-compatible with v5 via the existing `verify_proof` entry point.
