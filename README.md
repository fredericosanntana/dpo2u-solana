# dpo2u-solana

[![CI](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml/badge.svg)](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![SP1](https://img.shields.io/badge/SP1-v6.1.0-blue)](https://github.com/succinctlabs/sp1)
[![Solana](https://img.shields.io/badge/Solana-3.1.13-9945FF)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com)

Privacy-preserving LGPD/GDPR compliance attestation stack on **Solana** with **SP1** zero-knowledge proofs.

Part of the [DPO2U](https://github.com/fredericosanntana/DPO2U) compliance platform — this repo contains the Solana-specific layer: ZK circuits, on-chain verifier, and Anchor programs.

## Status

🟢 **Sprint 4c complete** — end-to-end Groth16 proof verification on Solana (localnet). Real on-chain tx confirmed: [`9GwKQ23yAjKk...574`](https://explorer.solana.com/tx/9GwKQ23yAjKkDGMMHRUBWcRHPb1QQ3kxULPCh52hoSRxBH3LJr41gewrSV78SxgDbPR4Qand3vNBczWdvZbR574?cluster=custom).

## What this does

An auditor (DPO, regulator) wants proof that a company's LGPD compliance score meets a policy threshold — without learning the actual score. The company generates a zero-knowledge proof of `score >= threshold`, commits to the subject identifier, and registers the attestation on Solana. Verifiers check the proof on-chain in ~156k compute units.

```
off-chain prover                       on-chain verifier
─────────────────                      ──────────────────────
score (private) ──┐                    Attestation PDA
threshold (pub) ──┼─► SP1 zkVM ──┐     keyed (subject, commitment)
subject (pub) ────┘              │      │
                                 ▼      ▼
                         Groth16 proof ───► sp1-solana verifier
                         (356 B, BN254)     → compliance-registry
```

## Stack

| Layer | Framework | Package |
|---|---|---|
| zkVM program (RISC-V) | SP1 6.1.0 | `zk-circuits/program/` |
| Prover CLI | sp1-sdk 6.0.1 + gnark | `zk-circuits/script/` |
| On-chain Groth16 verifier | sp1-solana (forked, patched for SP1 v6) | `sp1-solana/` |
| Attestation / DID / Payment programs | Anchor 0.31.1 | `solana-programs/` |

## Packages

### `zk-circuits/` — SP1 compliance_threshold circuit

Proves "there exists a private `score` such that `score >= threshold`, for a given public `threshold` + `subject_commitment`". Verifier sees only `{threshold, subject_commitment, meets_threshold}`, never the score itself.

- `lib/` — shared `PublicValuesStruct` (alloy-sol-types ABI)
- `program/` — zkVM RISC-V program compiled via cargo-prove
- `script/` — CLI: `./target/release/prove --prove --score 85 --threshold 70 --subject "did:..."`

See `zk-circuits/proofs/README.md` for reproduction steps and SP1 v6 proof format decoding.

### `sp1-solana/` — forked Groth16 verifier with SP1 v6 patch

Upstream sp1-solana (`succinctlabs/sp1-solana@4181cae`) supports SP1 up to v5. This fork adds:

- `verifier/src/lib.rs::verify_proof_v6()` — parses the SP1 v6 proof envelope (`exitCode + vkRoot + nonce` ABI-encoded before the 256 B Groth16 proof), validates metadata, and builds a 5-element `PublicInputs` vector for the pairing check.
- `verifier/vk/v6.1.0/groth16_vk.bin` — SP1 v6.1.0 verification key (492 B, 6 K points).
- `example/program/` → `dpo2u-compliance-verifier` — on-chain verifier program wired to DPO2U's program vkey hash.

### `solana-programs/` — 5 Anchor programs

| Program | Purpose |
|---|---|
| `compliance-registry` | Per-subject attestation PDA `[b"attestation", subject, commitment]`. Stores commitment + storage URI + issuer + revocation state. |
| `agent-registry` | Agent DID + capability bitmask (READ=1, WRITE=2, TREASURY=4, DEPLOY=8, GOVERNANCE=16). |
| `payment-gateway` | Invoice PDA `[b"invoice", payer, tool, nonce]` for MCP tool payments. |
| `fee-distributor` | 70/20/10 split: treasury / operator / reserve. |
| `agent-wallet-factory` | Deterministic PDA wallet per agent seed. |

## Quickstart

```bash
# Prerequisites: cargo 1.95+, solana-cli 3.1+, anchor 0.31.1, sp1up, cargo-prove
# (build on a box with ≥ 32 GB RAM — Groth16 wrap peaks at ~26 GB)

# 1. Build SP1 circuit + prover
cd zk-circuits
cargo build --release --bin prove

# 2. Generate a proof (first run ~25 min; subsequent runs ~5 min cached)
./target/release/prove --prove \
  --score 85 --threshold 70 \
  --subject "did:test:company:acme" \
  --out-proof proofs/proof.bin \
  --out-public proofs/public_values.bin \
  --out-vkey proofs/vkey.hex

# 3. Build the on-chain verifier
cd ../sp1-solana
cargo build-sbf --manifest-path example/program/Cargo.toml

# 4. Deploy to local validator
solana-test-validator --rpc-port 18899 &
solana program deploy target/deploy/dpo2u_compliance_verifier.so \
  --program-id target/deploy/dpo2u_compliance_verifier-keypair.json

# 5. Build Anchor programs
cd ../solana-programs
anchor build
anchor deploy  # or: solana program deploy ... per program
```

## Architecture notes

### Why Groth16 (not Plonk / STARK)?

- Smallest proof (~356 B vs kilobytes for STARKs) → cheap Solana tx
- Constant verification cost (pairing check) → predictable compute budget
- Solana BN254 precompile via `alt_bn128` syscalls → native performance

### Memory budget for proving

| Phase | Peak RAM |
|---|---|
| RISC-V execution | ~2 GB |
| Core STARK prove | 8–12 GB |
| Groth16 wrap (gnark) | 14–20 GB |
| **Total peak** | **~26 GB** (VM), ~19 GB anonymous resident |

Recommended: 32 GB RAM + 16-32 GB persistent swap for dev boxes. Production: SP1 network prover (Succinct Labs) eliminates local memory requirements.

### SP1 v6 proof format

96-byte envelope between the 4-byte selector and the 256-byte Groth16 proof:

```
bytes 0..4     selector   (sha256(GROTH16_VK)[..4])
bytes 4..36    exitCode   (u256, must be 0)
bytes 36..68   vkRoot     (u256, pinned SP1 version constant)
bytes 68..100  nonce      (u256, freely chosen by prover)
bytes 100..356 pi_a + pi_b + pi_c  (uncompressed G1, G2, G1)
```

Maps to **5 public inputs** for the pairing check (vs 2 in SP1 v5). See `sp1-solana/verifier/src/lib.rs::verify_proof_v6`.

## Contributing / Upstream

The v6 patch in `sp1-solana/` is minimal (~120 LOC) and backward-compatible with v5 via the untouched `verify_proof` entry point. An upstream PR to `succinctlabs/sp1-solana` is planned — meanwhile this fork tracks the v6 circuit.

## License

MIT — see `LICENSE`. The `sp1-solana/` fork retains the original MIT license from Succinct Labs.
