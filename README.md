# dpo2u-solana

**First LGPD-native zero-knowledge compliance attestation stack on Solana.**

[![CI](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml/badge.svg)](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm: @dpo2u/client-sdk](https://img.shields.io/npm/v/@dpo2u/client-sdk.svg?label=npm)](https://www.npmjs.com/package/@dpo2u/client-sdk)
[![crates: dpo2u-sdk](https://img.shields.io/crates/v/dpo2u-sdk.svg?label=crates.io)](https://crates.io/crates/dpo2u-sdk)
[![SP1](https://img.shields.io/badge/SP1-v6.1.0-blue)](https://github.com/succinctlabs/sp1)
[![Solana](https://img.shields.io/badge/Solana-3.1.13-9945FF)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com)

> ⚡ **Submission to Colosseum Frontier 2026 — [see team + narrative](./TEAM.md)**

> 🚀 **Dev? START HERE → [ONBOARDING.md](./ONBOARDING.md)** · Hello World em 4 stacks (JS/Rust/REST/MCP) em 5–10 min · [runnable examples/](./examples/) · [send feedback](https://github.com/fredericosanntana/dpo2u-solana/issues/new?template=devs-feedback.md)

An auditor needs to verify a company's LGPD/GDPR compliance score meets a
policy threshold — without learning the score itself. `dpo2u-solana` closes
this contradiction: the company generates a zero-knowledge proof of
`score ≥ threshold`, the Solana on-chain verifier runs the Groth16 pairing
check in ~156k compute units (~$0.0002), and only then does the compliance
registry record the attestation PDA.

Score stays private. Proof is public. Everything is enforceable.

---

## 🎬 Demo

> 📺 **3-minute screencast — DPO2U Composed Stack live on Solana devnet.**
> YouTube unlisted link landed in the `[Final hand-off]` commit at submission time. Until then, judges can reproduce the proof flow locally in ~60s using the commands below — no SP1 install, no validator setup. Voiceover narration (5 chunks, 114s total) ships in [`docs/DEMO.md`](./docs/DEMO.md).

**60-second reproducibility — no SP1 install, no validator setup:**

```bash
git clone https://github.com/fredericosanntana/dpo2u-solana
cd dpo2u-solana/sp1-solana

# Run the committed proof through the on-chain verifier via solana-program-test
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

For the end-to-end integration — proof → verifier CPI → attestation PDA:

```bash
cd solana-programs && pnpm install && pnpm test
# 19 tests pass: scaffolds + verified-attestation (happy path + 3 rejection modes)
```

---

## 🏗️ Architecture

```
off-chain prover                       on-chain
─────────────────                      ────────────────────────────────
score (private) ──┐                    compliance-registry
threshold (pub) ──┼─► SP1 v6 zkVM ──┐  create_verified_attestation
subject (pub) ────┘                 │       │
                                    ▼       ▼ CPI
                       Groth16 proof ──► dpo2u-compliance-verifier
                       (356 B, BN254)         │
                                              ▼
                                       alt_bn128 syscall
                                       (Solana BN254 precompile)
                                              │
                                              ▼ Ok ✓
                                       write Attestation PDA
                                       { subject, commitment, verified=true,
                                         threshold, issuer, timestamps }
```

The **CPI link** is the load-bearing detail: `compliance-registry` does not
trust the caller's claimed commitment — it ABI-decodes `PublicValuesStruct`
from the proof's public values, requires `commitment == subject_commitment`
from the proof, requires `meets_threshold == true`, and only then delegates
to the verifier. If the Groth16 pairing fails inside the CPI, the whole
transaction reverts — no attestation is written.

---

## 📦 Repository layout

| Path | Role |
|---|---|
| [`zk-circuits/program/`](./zk-circuits/program) | SP1 v6 RISC-V program that proves `score ≥ threshold` |
| [`zk-circuits/lib/`](./zk-circuits/lib) | `PublicValuesStruct` ABI shared host/zkVM |
| [`zk-circuits/script/`](./zk-circuits/script) | Prover CLI (`execute` \| `prove --groth16`) |
| [`zk-circuits/proofs/`](./zk-circuits/proofs) | **Committed fixture proof** (threshold=70, subject=`did:test:company:acme`) |
| [`sp1-solana/verifier/`](./sp1-solana/verifier) | Forked Groth16 verifier + **SP1 v6 patch** (`verify_proof_v6`) |
| [`sp1-solana/example/program/`](./sp1-solana/example/program) | `dpo2u-compliance-verifier` — on-chain program wrapping the verifier |
| [`sp1-solana/example/script/`](./sp1-solana/example/script) | `dpo2u-driver` — Rust CLI for local reproducibility |
| [`solana-programs/programs/`](./solana-programs/programs) | 5 Anchor programs (see below) |
| [`solana-programs/tests/`](./solana-programs/tests) | LiteSVM + solana-bankrun test suites (25 tests) |
| [`packages/client-sdk/src/storage/`](./packages/client-sdk/src/storage) | Pluggable storage backends (mock / ipfs / Shadow Drive v1) |

### Anchor programs

| Program | Program ID (devnet) | Purpose |
|---|---|---|
| [`compliance-registry`](./solana-programs/programs/compliance-registry) | `7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK` | ZK-verified attestation PDAs |
| [`dpo2u-compliance-verifier`](./sp1-solana/example/program) | `5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW` | SP1 v6 Groth16 verifier |
| [`agent-registry`](./solana-programs/programs/agent-registry) | `5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7` | DPO/auditor agent DIDs + capability bitmask |
| [`payment-gateway`](./solana-programs/programs/payment-gateway) | `4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q` | MCP tool-call invoicing (idempotent by nonce) |
| [`fee-distributor`](./solana-programs/programs/fee-distributor) | `88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x` | 70/20/10 split: treasury / operator / reserve |
| [`agent-wallet-factory`](./solana-programs/programs/agent-wallet-factory) | `AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in` | Deterministic PDA wallet per agent seed |

> ✅ **Deployed to Solana devnet 2026-04-21.** All 6 programs live — full deploy log with transaction signatures and Explorer links in [`docs/devnet-deployments.md`](./docs/devnet-deployments.md). Smoke-tested end-to-end: `dpo2u-cli attest` successfully submitted a ZK proof through `compliance_registry` → `dpo2u_compliance_verifier` CPI, generating attestation PDA `71b2EPzrDm4UbcatmPPhHmPAqQfzas38FnvyQp1tJ16c` ([tx](https://explorer.solana.com/tx/66J8DEZNbZr3u6zxeoM5PZESDHa8mDy6UkpeYUiwLrNjAvsQMwfMcG2NyBUe2ZETUoTWJBHMGy5ctZhVdXYR9z2g?cluster=devnet)).

---

## 🇧🇷 LGPD Art. 18 — right to erasure (only on Solana)

Blockchain compliance stacks usually handwave past the "right to be forgotten." LGPD Art. 18 (and GDPR Art. 17) gives the data subject a legal right to demand deletion of their personal data. If PII is stored on-chain or on an immutable off-chain store (IPFS, Arweave, Shadow Drive v2), there is no answer. DPO2U's answer: **past compliance provable forever, personal data deletable on demand.**

### How

| Layer | What's there | Deletable? |
|---|---|---|
| **On-chain** Attestation PDA | `commitment: [u8; 32]` — irreversibly hashed PII. Not recoverable without the payload. | No. Doesn't need to be — it is not PII without the payload. |
| **Off-chain** payload at `storage_uri` | DPIA document, consent record, audit evidence — may contain PII | **Yes, via Shadow Drive v1** (the only Solana-native mutable storage). |

### Storage backend matrix

| Backend | Deletable? | LGPD Art. 18 | Solana-native | Cost model |
|---|---|---|---|---|
| IPFS (public gateway) | ❌ content-addressed | Fails | ❌ | Grátis |
| Shadow Drive **v1** | ✅ | **Cumpre** | ✅ | SHDW rent (continuous) |
| Shadow Drive v2 | ❌ pay-once immutable | Fails | ✅ | SHDW/SOL one-shot |
| Arweave | ❌ permanent | Fails | ❌ | AR one-shot |
| `mock` (in-memory) | ✅ | test-only | n/a | free |

### Demo — end-to-end erasure flow

```bash
# 1. Attest with uploaded PII payload
dpo2u-cli attest --cluster devnet \
  --upload ./consent-record.json --backend mock \
  --proof zk-circuits/proofs/proof.bin \
  --public-values zk-circuits/proofs/public_values.bin
# → storage_uri = mock://abc123/consent-record.json

# 2. Data subject exercises Art. 18 on 2026-05-15
dpo2u-cli erase --cluster devnet \
  --subject <pubkey> --commitment <hex> \
  --reason "LGPD_ART_18_REQUEST_2026-05-15" \
  --backend mock
# ✓ payload deleted  : mock://abc123/consent-record.json (backend=mock)
# ✓ on-chain revoke  : sig <tx>
# ✓ revoked_at       : 2026-05-15T12:00:00Z
# ✓ reason on-chain  : LGPD_ART_18_REQUEST_2026-05-15

# 3. Re-fetch — PII gone, on-chain commitment preserved
dpo2u-cli fetch --cluster devnet --subject <pk> --commitment <hex>
# revokedAt        : 1747310400
# revocationReason : "LGPD_ART_18_REQUEST_2026-05-15"
# commitment       : 0x... (survives — is not PII without the payload)
```

### For production

Mainnet deploy uses `--backend shdw --cluster mainnet-beta --shdw-storage-account <pk>`. Shadow Drive does not support devnet; for the hackathon demo, we use the mock backend to exercise the full lifecycle. Architecture is pluggable and ship-ready.

Test coverage: 3 e2e specs in [`solana-programs/tests/erasure.test.ts`](./solana-programs/tests/erasure.test.ts) covering happy path (upload + attest + erase + re-fetch invariants), unauthorized revoke, and double-revoke rejection.

---

## 🧪 Technical novelty — SP1 v6 patch

Upstream [`succinctlabs/sp1-solana`](https://github.com/succinctlabs/sp1-solana@4181cae)
supports SP1 v5. v6 changed the proof envelope format (added `exitCode + vkRoot + nonce` metadata and expanded public inputs from 2 to 5). This fork adds a new `verify_proof_v6` entry point (~120 LOC) that:

1. Parses the 96 B metadata envelope between the selector and the Groth16 proof
2. Validates `exitCode == 0` (zkVM halted successfully) and `vkRoot == expected` (pinned per SP1 version — prevents circuit-version confusion attacks)
3. Builds a 5-input `PublicInputs` vector and runs the pairing via `groth16-solana`

The existing `verify_proof` v5 entry point is untouched — the fork is
backward-compatible. An upstream PR to `succinctlabs/sp1-solana` is
planned.

Regression tests (committed fixtures + 4 scenarios — positive, tampered,
non-zero exit, wrong vk_root) live in
[`sp1-solana/verifier/tests/dpo2u_v6.rs`](./sp1-solana/verifier/tests/dpo2u_v6.rs).

```
bytes 0..4     selector   (sha256(GROTH16_VK_6_1_0)[..4])
bytes 4..36    exitCode   (u256, must be 0)
bytes 36..68   vkRoot     (u256, pinned: 0x002f850e...f25352 for v6.1.0)
bytes 68..100  nonce      (u256, freely chosen by prover)
bytes 100..356 pi_a + pi_b + pi_c  (uncompressed G1, G2, G1)
```

---

## 📐 Why Solana

| Constraint | Why Solana wins |
|---|---|
| Proof verification cost | BN254 precompile via `alt_bn128_*` syscalls — ~156k CU per pairing |
| Transaction economics | ~$0.0002 per attestation → LGPD-scale volumes feasible |
| Groth16 proof size | 356 B fits in one tx, no lookup tables |
| Finality | Sub-second — compliance events can be referenced same block |
| Ecosystem | Privacy-adjacent infra (Arcium, Light Protocol) actively growing |

---

## 🧬 Composed Stack — 4 Solana-native primitives in one atomic transaction

Sprint 2026-05-08: addressing Colosseum feedback that the project wasn't
"Solana-native enough", we added a layer that composes 4 primitives **unique
to Solana** in a single atomic transaction:

| Layer | Role | Why Solana-only |
|-------|------|-----------------|
| **Pinocchio** orchestrator | CU-efficient native program — validates SP1 + builds leaf + drives CPI | Pinocchio = Solana zero-copy framework (no Anchor overhead) |
| **Light Protocol** state compression | Writes `AttestationLeaf` (252 bytes) to shared CMT via `InvokeCpi` | Relies on `alt_bn128` syscalls for on-chain Groth16 verify (~5-50k CU) |
| **Shadow Drive** immutable payload | DPIA, evidence, jurisdiction-specific attachments with `make-immutable` | Solana-native decentralized storage ($SHDW pre-paid) |
| **Squads v4** multisig | 5 segregated vaults (Governance / Treasury / MiCAR Reserve / Compliance Authority / Emergency) | Vault PDA = plain `Pubkey` to programs — zero new code to govern |

### Per-attestation cost (devnet)

| Mode | Cost | Capital |
|------|------|---------|
| Regular account (compliance-registry) | ~$0.34 | LOCKED in rent (never recovered) |
| **Compressed (composed flow)** | **~$0.032** | Consumed (not locked) |
| Ratio | **~10x cheaper** + capital efficient | Break-even ~25k attestations/year vs Helius Photon Pro |

### Devnet state (2026-05-08)

✅ Pinocchio program `FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8` deployed
   (177KB, selectors `0x03 submit_verified_compressed` + `0x04 revoke_compressed`)
✅ 5 Squads v4 multisigs created — PDAs in [`scripts/squads-config.json`](./scripts/squads-config.json)
✅ Light Protocol shared trees identified — config in [`scripts/cmt-config.json`](./scripts/cmt-config.json)
✅ SP1 Groth16 verify CPI working (devnet smoke test — 263k CU consumed)
🟡 **Awaiting** [Light Foundation issue #2378](https://github.com/Lightprotocol/light-protocol/issues/2378) —
   program registration in `compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq` to unblock Light CPI

### Documentation

- [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md) — Squads v4 architecture, threshold rationale, Light registration prerequisite
- [`solana-programs/programs/compliance-registry-pinocchio/src/light_proto.rs`](./solana-programs/programs/compliance-registry-pinocchio/src/light_proto.rs) — Light Protocol Borsh structs (verified against upstream main)
- [`packages/client-sdk/src/composed.ts`](./packages/client-sdk/src/composed.ts) — `submitComposedAttestation()` E2E orchestration
- [`packages/client-sdk/src/photon.ts`](./packages/client-sdk/src/photon.ts) — Photon Indexer wrapper

### Pitch line

> "DPO2U: 4 atomic Solana primitives in a single transaction — **Pinocchio**
> validates the SP1 ZK proof and writes to a **Light Protocol** compressed
> account (≤$0.032/op vs $0.34 LOCKED rent), referencing an immutable payload
> in **Shadow Drive**, governance trustless via **Squads v4** with 24h
> time-lock across 5 segregated vaults. A stack that **only composes
> atomically on Solana** — on any EVM/L2 this becomes 4 separate protocols
> bridged together."

---

## 🧠 Why Brazil

LGPD (Lei Geral de Proteção de Dados, 2020) is the motivating regime. The
collision between "the auditor must verify the score" and "but the score
itself is sensitive business data" is a live problem facing ~50M registered
CNPJs. The design primitives (threshold policies, DPO workflows, subject
commitments as `did:br:cnpj:...`) are LGPD-native, not retrofitted. The
same stack generalizes — but starting from a real regulatory reality
produces better primitives than starting from a spec.

See [TEAM.md](./TEAM.md) for the team + shipping model.

---

## 🚀 Running things locally

### Fast path — verify a committed proof (no SP1 install)

```bash
cd sp1-solana && cargo run --release -p dpo2u-driver -- --verbose
```

### Full path — regenerate a proof from scratch (needs 32 GB RAM)

```bash
cd zk-circuits
cargo build --release --bin prove

./target/release/prove --prove \
  --score 85 --threshold 70 \
  --subject "did:br:cnpj:12.345.678/0001-99" \
  --out-proof proofs/proof.bin \
  --out-public proofs/public_values.bin \
  --out-vkey proofs/vkey.hex
# First run: ~25 min + ~26 GB peak RAM (Groth16 wrap)
# Subsequent runs: ~5 min (cached setup)
```

### Build & test the Anchor programs

```bash
cd solana-programs
anchor build
pnpm install
pnpm test    # 19 tests: 15 scaffolds + 4 verified-attestation (CPI)
```

### Deploy to devnet

```bash
# Assumes you have a funded devnet wallet at ~/.config/solana/id.json
solana config set -ud
solana airdrop 50   # may need multiple + faucet.solana.com for large balances

cd sp1-solana/example/program
cargo build-sbf --sbf-out-dir ../../target/deploy
solana program deploy ../../target/deploy/dpo2u_compliance_verifier.so

cd ../../../solana-programs
anchor deploy --provider.cluster devnet
```

---

## 📂 Documentation

- [**`TEAM.md`**](./TEAM.md) — team, chairman + AI-agent model, Brazil context
- [**`docs/HACKATHON.md`**](./docs/HACKATHON.md) — submission checklist & targets
- [`sp1-solana/README.md`](./sp1-solana/README.md) — v6 verifier library deep dive
- [`zk-circuits/proofs/README.md`](./zk-circuits/proofs/README.md) — SP1 v6 proof format, reproduction steps
- [`solana-programs/tests/README.md`](./solana-programs/tests/README.md) — test harness notes

## 🤝 Contributing / Upstream

The v6 patch in `sp1-solana/` is minimal (~120 LOC) and backward-compatible
with v5 via the untouched `verify_proof` entry point. An upstream PR to
`succinctlabs/sp1-solana` is planned.

For DPO2U-level contributions, open a GitHub issue or PR.

## License

MIT — see [`LICENSE`](./LICENSE). The `sp1-solana/` fork retains the
original MIT license from Succinct Labs.

---

*Brasil vai ser o flagship market da Solana. Não é IF, é WHEN.* 🇧🇷
