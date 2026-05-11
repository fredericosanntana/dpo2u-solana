# dpo2u-solana

### The HTTPS of compliance — for Web2 and Web3.

**A protocol that seals two regimes in one transaction: privacy and AI governance. 17 jurisdictions. 70+ countries. 14 Anchor programs on Solana devnet.**

[![CI](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml/badge.svg)](https://github.com/fredericosanntana/dpo2u-solana/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm: @dpo2u/client-sdk](https://img.shields.io/npm/v/@dpo2u/client-sdk.svg?label=npm)](https://www.npmjs.com/package/@dpo2u/client-sdk)
[![crates: dpo2u-sdk](https://img.shields.io/crates/v/dpo2u-sdk.svg?label=crates.io)](https://crates.io/crates/dpo2u-sdk)
[![SP1](https://img.shields.io/badge/SP1-v6.1.0-blue)](https://github.com/succinctlabs/sp1)
[![Solana](https://img.shields.io/badge/Solana-3.1.13-9945FF)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4)](https://www.anchor-lang.com)

> ⚡ **Submission to Colosseum Frontier 2026 — [see team + narrative](./TEAM.md)** · Also targeting the **[Cloak](https://cloak.ag) side track** ([see Cloak Bridge](#-cloak-bridge--compliance--audit-tooling-for-solanas-shielded-pools))

> 🚀 **Dev? START HERE → [ONBOARDING.md](./ONBOARDING.md)** · Hello World in 4 stacks (JS/Rust/REST/MCP) in 5–10 min · [runnable examples/](./examples/) · [send feedback](https://github.com/fredericosanntana/dpo2u-solana/issues/new?template=devs-feedback.md)

### Compliance lost its seal. We are putting it back on-chain.

Compliance was born as a wax seal. For a thousand years an act became binding the moment hot wax met paper — demonstrable, infalsifiable, verifiable by anyone who could look. We digitized everything and lost the seal. Today compliance is theater: PDFs no one reads, spreadsheets no one accesses. When proof is demanded, the regulated entity is forced to hand sensitive data to a third party. **Meta paid €1.2 billion in EU privacy fines in 2023.** They had a compliance program, a named DPO, and a PDF. The PDF prevented nothing — because compliance based on documents is compliance based on faith.

**DPO2U inverts it: the score stays private, the proof goes on-chain.**

A regulated entity computes its compliance score off-chain across **17 privacy jurisdictions and 70+ countries**, plus **6 AI-governance frameworks** (EU AI Act, Korea AI Basic Act, Hiroshima ICOC, UNESCO RAM, Japan AISI, CAIDP Universal Guidelines). It generates an SP1 v6 Groth16 zero-knowledge proof that `score ≥ threshold`. The proof is 356 bytes. It ships to Solana. The on-chain verifier runs the BN254 pairing check in **~156k compute units (~$0.0002)** via the `alt_bn128` precompile, and only then does the registry write an attestation PDA.

**Score stays private. Proof is public. Event is enforceable.**

DPO2U is an MCP that turns law into code. Rules become circuits. Evidence becomes on-chain attestations. Audits become real-time cryptographic verification — callable by any wallet, smart contract, or AI agent. The only protocol that seals both privacy and AI-governance regimes at once, enabling **institutional regulated real-world assets** on Solana.

---

## 🎯 For judges — 60-second path

| Path | What to do | What you'll see |
|---|---|---|
| **Live demo video** | Open <https://dpo2u.com/downloads/demo/dpo2u-demo-2026.mp4> | 90s Composed Stack screencast |
| **Live MCP server** | `curl https://mcp.dpo2u.com/health` | `{"status":"healthy"}` — 66 endpoints across 17 jurisdictions |
| **Live attestation PDA** | [`71b2EPzrDm4UbcatmPPhHmPAqQfzas38FnvyQp1tJ16c`](https://explorer.solana.com/address/71b2EPzrDm4UbcatmPPhHmPAqQfzas38FnvyQp1tJ16c?cluster=devnet) on Solana Explorer | A real verified attestation written by [this tx](https://explorer.solana.com/tx/66J8DEZNbZr3u6zxeoM5PZESDHa8mDy6UkpeYUiwLrNjAvsQMwfMcG2NyBUe2ZETUoTWJBHMGy5ctZhVdXYR9z2g?cluster=devnet) |
| **Reproduce locally (60s)** | `git clone … && cd dpo2u-solana/sp1-solana && cargo run --release -p dpo2u-driver -- --verbose` | Pairing check passes on the Solana runtime — no SP1 install required |
| **Landing + pricing** | <https://dpo2u.com> · <https://dpo2u.com/pricing> | Live |

---

## 🎬 Demo

> 📺 **90-second screencast — DPO2U Composed Stack live on Solana devnet.**
> Watch: **<https://dpo2u.com/downloads/demo/dpo2u-demo-2026.mp4>** (8.7 MB, MP4). Long-form pitch: **<https://dpo2u.com/downloads/pitch/dpo2u-pitch-2026.mp4>** (57 MB). Judges can also reproduce the full proof flow locally in ~60s using the commands below — no SP1 install, no validator setup. Voiceover narration (5 chunks, 114s total) and scene-by-scene script in [`docs/DEMO.md`](./docs/DEMO.md).

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

## 🧹 Right to erasure — across 17 jurisdictions, only solvable on Solana

Blockchain compliance stacks usually handwave past the "right to be forgotten." But the right to erasure is not a Brazilian or European quirk — it is a statutory right in nearly every modern privacy regime:

| Jurisdiction | Provision | Region |
|---|---|---|
| Brazil — LGPD | Art. 18, VI | Latin America |
| EU + UK — GDPR | Art. 17 | EMEA |
| California — CCPA / CPRA | § 1798.105 | North America |
| Canada — PIPEDA / Quebec Law 25 | Principle 4.5 / Art. 28 | North America |
| India — DPDP | § 12 | APAC |
| Korea — PIPA | Art. 36 | APAC |
| Japan — APPI | Art. 30 | APAC |
| Singapore + Malaysia — PDPA | s.16 / s.39 | APAC |
| Indonesia — UU PDP | Art. 31 | APAC |
| Vietnam — Decree 13 | Art. 9 | APAC |
| South Africa — POPIA | § 24 | Africa |
| Nigeria — NDPA | § 36 | Africa |
| UAE + ADGM — PDPL | Art. 16 | MEA |
| Mexico — LFPDPPP | Art. 25 | LatAm |

If PII is stored on-chain or on an immutable off-chain store (IPFS, Arweave, Shadow Drive v2), there is no answer for any of these regulators. DPO2U's answer is the same regardless of jurisdiction: **past compliance provable forever, personal data deletable on demand.**

### How

| Layer | What's there | Deletable? |
|---|---|---|
| **On-chain** Attestation PDA | `commitment: [u8; 32]` — irreversibly hashed PII. Not recoverable without the payload. | No. Doesn't need to be — it is not PII without the payload. |
| **Off-chain** payload at `storage_uri` | DPIA document, consent record, audit evidence — may contain PII | **Yes, via Shadow Drive v1** (the only Solana-native mutable storage). |

### Storage backend matrix

| Backend | Deletable? | Erasure-compliant (all 14 regimes above) | Solana-native | Cost model |
|---|---|---|---|---|
| IPFS (public gateway) | ❌ content-addressed | Fails | ❌ | Free |
| Shadow Drive **v1** | ✅ | **Complies** | ✅ | SHDW rent (continuous) |
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
| Transaction economics | ~$0.0002 per attestation → regulator-scale volumes feasible across all 17 jurisdictions and 70+ countries |
| Groth16 proof size | 356 B fits in one tx, no lookup tables |
| Finality | Sub-second — compliance events can be referenced same block |
| Ecosystem | Privacy-adjacent infra (Arcium, Light Protocol) actively growing |

---

## 🧬 Composed Stack — 4 Solana-native primitives in one atomic transaction

DPO2U composes four primitives **unique to Solana** in a single atomic
transaction. The composition does not exist on any EVM chain — it would
require four separate protocols bridged together. Here it is one tx:

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

## 🕶️ Cloak Bridge — compliance & audit tooling for Solana's shielded pools

**Targeting the [Cloak](https://cloak.ag) side track** at Colosseum Frontier. Code at [`apps/cloak-bridge/`](./apps/cloak-bridge) — published as `@dpo2u/cloak-bridge` v0.1.0-alpha.

### The problem & who it's for

Cloak makes private USDC / USDT / SOL transactions live on Solana mainnet today. The moment an organization adopts Cloak for payroll, B2B settlement, treasury, or cross-border flows, the question shifts from "can we transact privately?" to **"how do we prove compliance over private transactions?"** Every regime we cover gives the data subject confidentiality *and* gives the regulator audit rights — LGPD, GDPR, DPDP, MiCAR (for ART issuers), POPIA, CCPA. Most "private" stacks force a choice: either the auditor sees nothing (regulator cannot enforce) or the protocol exposes the data in the clear (user's privacy collapses).

Cloak's **viewing key** is the design primitive that lets both be true. Cloak Bridge is the tool that turns a viewing key into an **on-chain compliance attestation** — without ever copying the underlying transactions outside the auditor's machine.

**Target user:** finance teams, external auditors, and regulators acting over an organization that already runs on Cloak. The product is **compliance and audit tooling** — direction #4 in Cloak's track brief.

### How the Cloak SDK is used (and why it's central)

The viewing-key capability is the single load-bearing primitive — without it, this product cannot exist. The bridge consumes a `ViewingKeyMaterial` from `@cloak.dev/sdk`, calls `scanTransactions` against a target account over a configurable period, and feeds the decrypted history into the DPO2U analyzer pipeline:

```
auditor receives Cloak viewing key (scoped: entity + period + amount-visibility)
        │
        ▼
cloak-bridge.scanHistory(viewingKey, periodStart, periodEnd)
   └─ @cloak.dev/sdk · scanTransactions  ← Cloak SDK call
        │
        ▼  decrypted CloakAccountHistory (in-auditor-memory only)
3 analyzers run over the history:
  · MiCAR Art. 23  — stablecoin reserve coverage
  · MiCAR Art. 36  — redemption / velocity caps
  · LGPD  Art. 16  — retention (stale notes past declared window)
        │
        ▼  facts kept off-chain (encrypted at rest); sha256(facts) committed
SP1 v6  proof of  score ≥ threshold
        │
        ▼  CPI through dpo2u-compliance-verifier
attestation PDA in compliance-registry
        │
        ▼
auditor publishes the attestation reference; raw shielded txs stay private forever
```

The bridge consumes the **viewing key** capability deeply (not incidentally) — it is the *only* way the analyzers can run, because Cloak transactions are otherwise opaque on-chain. Roadmap items below extend the integration to **selective scoping** (issue narrower keys per analyzer) and **stealth-address attestation receipts** so the auditor's verdict reaches the data subject without revealing the auditor's identity either.

### What ships in this submission (v0.1.0-alpha)

| File | Role | LOC |
|---|---|---|
| [`src/cloak/client.ts`](./apps/cloak-bridge/src/cloak/client.ts) | `CloakProvider` interface + `loadCloakSdkProvider()` (dynamic-imports `@cloak.dev/sdk`) + `MockCloakProvider` for unit tests | 107 |
| [`src/cloak/types.ts`](./apps/cloak-bridge/src/cloak/types.ts) | `ViewingKeyMaterial`, `CloakAccountHistory`, `CloakTx` | 27 |
| [`src/analyzers/base.ts`](./apps/cloak-bridge/src/analyzers/base.ts) | `Analyzer` interface + `AnalyzerResult` (verdict, 0–100 score, off-chain facts + commitment) | 32 |
| [`src/analyzers/micar-art23.ts`](./apps/cloak-bridge/src/analyzers/micar-art23.ts) | **MiCAR Art. 23** — reserve coverage analyzer | 60 |
| [`src/analyzers/micar-art36.ts`](./apps/cloak-bridge/src/analyzers/micar-art36.ts) | **MiCAR Art. 36** — redemption / velocity caps analyzer | 70 |
| [`src/analyzers/lgpd-retention.ts`](./apps/cloak-bridge/src/analyzers/lgpd-retention.ts) | **LGPD Art. 16** — retention analyzer over Cloak notes | 47 |

### Setup & run

```bash
# 1. Install the Cloak SDK (peer dep)
cd apps/cloak-bridge
pnpm install
pnpm add @cloak.dev/sdk   # optional — bridge falls back to MockCloakProvider if absent

# 2. Build the bridge
pnpm build

# 3. Use programmatically (CLI ships in v0.2 — track this in the issues tab)
node -e "
  const { LgpdRetentionAnalyzer } = require('@dpo2u/cloak-bridge');
  const analyzer = new LgpdRetentionAnalyzer();
  // …feed it a CloakAccountHistory from @cloak.dev/sdk's scanTransactions
"
```

The MiCAR + LGPD analyzer set was chosen deliberately: stablecoin issuers using Cloak for treasury sit exactly at the intersection of MiCAR (EU stablecoin regulation, in force) and LGPD/GDPR data-protection requirements. These are the two regimes where shielded-pool auditability is currently most contested — and where the gap in tooling is most expensive.

### Roadmap

- **v0.2** (within 2 weeks of Colosseum) — first-class CLI (`dpo2u-cloak-bridge attest --viewing-key … --analyzer micar-art23 --period last-quarter`), runnable example notebook, integration tests against Cloak devnet/sandbox if one becomes available.
- **v0.3** — additional analyzers (POPIA § 14 minimization, DPDP § 7 lawful processing), scoped viewing-key issuance (per-analyzer narrower keys), stealth-address attestation receipts to the data subject.
- **v1.0** — production deploy of the attestation registry on mainnet via Squads v4 governance; partnership with one Cloak-using stablecoin issuer as design partner.

> **Honest status note for Cloak judges**: this is a working scaffold (343 LOC, MIT, no fabricated demos). The analyzer logic is real; the SP1 → CPI path is the same one used by the 19 passing tests in `solana-programs/tests/`. End-to-end against the live Cloak SDK lands in the v0.2 cut, where we will also produce a runnable demo video specifically for this track. Cloak's `@cloak.dev/sdk` reaching public beta unblocks the same window.

---

## ⏱️ Why now

For the decade I worked as an in-house Data Protection Officer, the cryptographic
primitives needed to make compliance enforceable on-chain did not exist at a price
point regulators could enforce. In the last twelve months three things changed:

1. **Solana shipped the `alt_bn128_*` syscalls.** On-chain Groth16 pairing
   verification now costs about two hundredths of a cent per attestation. On EVM
   the same operation is economically unviable. Compliance-scale attestation
   volume is feasible here today and nowhere else.
2. **SP1 reached v6 as a general-purpose zkVM.** Ordinary Rust compiles to a
   zero-knowledge proof. We no longer hand-author circuits per regulation — one
   zkVM covers seventeen jurisdictions today and accommodates the next ten with
   code, not cryptography.
3. **The regulatory surface tripled.** The EU AI Act took effect; Korea passed
   an AI Basic Act; India's DPDP began enforcement; Brazil's ANPD intensified
   LGPD action; the Hiroshima AI Process pulled sixty G7+invited countries into
   voluntary AI-governance attestation. With AI agents proliferating, compliance
   events are about to be measured per-decision, not per-quarter.

The cryptographic stack, the regulatory demand, and an operator who has lived
the problem for fifteen years all converged this year. The window did not exist
in 2016, in 2020, or in 2023. We do not believe it will still be open in 2027.

---

## 📈 Market & model

Compliance is a **$23B market today, projected to reach $105B by 2034**. A multinational fintech routinely spends six figures a year on redundant compliance work that does not produce an artifact a regulator can verify in real time. DPO2U makes that a single API call.

| Lever | Number |
|---|---|
| Per-attestation latency on Solana | **< 2 seconds** finality |
| Per-attestation cost (regular PDA) | **~$0.0002** (BN254 syscall, ~156k CU) |
| Per-attestation cost (compressed via Composed Stack) | **~$0.032** (~10× cheaper at scale) |
| Pricing vs traditional compliance consulting | **50%** of consulting equivalent (3 tiers: Free / Builder $29 / Team $199 — see [dpo2u.com/pricing](https://dpo2u.com/pricing)) |
| Target gross margin | **~82%** |
| Capital posture | SAFE round, **$3M post-money** |

The thesis: compliance that scales at the speed of software, not the speed of legal. The only protocol that seals **both** privacy and AI-governance regimes in one atomic transaction — enabling institutional regulated **real-world assets** on Solana.

---

## 🧠 Why Brazil first

LGPD (Lei Geral de Proteção de Dados, 2020) is the motivating regime and the
beachhead market — ~50M active CNPJs, a flagship Superteam chapter, and a DPO
profession that already exists statutorily. The design primitives (threshold
policies, DPO workflows, subject commitments as `did:br:cnpj:...`) are
LGPD-native, not retrofitted from a generic spec.

The same primitives generalize: the live MCP server at
[`mcp.dpo2u.com`](https://mcp.dpo2u.com) already serves 17 privacy jurisdictions
covering 70+ countries plus six AI-governance frameworks
(see [`dpo2u.com/coverage`](https://dpo2u.com/coverage)). Starting from a
specific regulatory reality produced better primitives than starting from a
spec would have. Brazil first — every regulated entity next.

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

> *The question is not whether regulation will reach on-chain. It is who will build the protocol it runs on top of. We are. We are DPO2U — the HTTPS of compliance, for Web2 and Web3.*
>
> ***Seal with us.***

*Brasil vai ser o flagship market da Solana. Não é IF, é WHEN.* 🇧🇷
