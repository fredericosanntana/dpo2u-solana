# Review Guide — dpo2u-solana (Colosseum / TheGarage)

**Branch**: `demo-day-prep` · **Commit**: see `git rev-parse HEAD`
**Prepared**: 2026-04-23 · **For**: Kaue + TheGarage review
**Contact**: Frederico Santana (fredericosanntana@gmail.com)

---

## TL;DR

Privacy-preserving LGPD/GDPR/DPDP/MiCAR compliance attestation on Solana, driven by SP1 Groth16 proofs.
A data controller proves a compliance predicate (e.g. "score ≥ threshold", "reserves cover issuance",
"consent granted for purpose X") in zero knowledge off-chain; the proof is verified on-chain via a
patched SP1 v6 verifier and committed to a PDA in `compliance-registry`. Public state is a commitment
hash + pass/fail bit; private inputs never leave the prover.

Eight programs are live on devnet, end-to-end smoke test passes, and the full OAuth + MCP tool
surface — including the new `erase_attestation_payload` composer tool for LGPD Art. 18 and the
`describe_pipeline` tool that returns the canonical protocol ordering — is reachable at
`mcp.dpo2u.com`. The MidnightDriver placeholder was removed; Midnight is a v2 roadmap item, not
an artifact of the shipping code.

## Architecture at a glance

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────────────────────────┐
│ Controller  │──► │  MCP server  │──► │  Solana devnet                      │
│ (data owner)│    │ mcp.dpo2u.com│    │  ┌─────────────────────────────────┐│
│             │    │              │    │  │ compliance-registry             ││
│  SP1 prover │    │  • 40+ tools │    │  │   ├── Attestation PDA           ││
│  (off-chain)│    │  • OAuth PKCE│    │  │   └── CPI → SP1 v6 verifier ────││┐
│             │    │  • Zod in    │    │  ├─────────────────────────────────┘│
│  Groth16    │    │  • Borsh IDL │    │  │ consent-manager (DPDP §6)       │ │
│  ┌────────┐ │    │              │    │  │ art-vault (MiCAR Art. 23/36)    │ │
│  │ proof  │ │    │              │    │  │ payment-gateway (SPL invoices)  │ │
│  │ 356 B  │─│───►│────Bearer───►│───►│  │ fee-distributor (70/20/10 CPI)  │ │
│  └────────┘ │    │              │    │  │ agent-registry (DID + perms)    │ │
└─────────────┘    └──────────────┘    │  └─────────────────────────────────┘ │
                                       │  ┌─────────────────────────────────┐ │
                                       │  │ dpo2u-compliance-verifier      ◄┼─┘
                                       │  │ (patched sp1-solana v6)         │
                                       │  └─────────────────────────────────┘
                                       └─────────────────────────────────────┘
```

## Devnet deployments

| Program | ID | Explorer |
|---|---|---|
| compliance-registry | `7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK` | [view](https://explorer.solana.com/address/7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK?cluster=devnet) |
| consent-manager | `D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB` | [view](https://explorer.solana.com/address/D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB?cluster=devnet) |
| art-vault | `C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna` | [view](https://explorer.solana.com/address/C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna?cluster=devnet) |
| payment-gateway | `4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q` | [view](https://explorer.solana.com/address/4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q?cluster=devnet) |
| fee-distributor | `88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x` | [view](https://explorer.solana.com/address/88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x?cluster=devnet) |
| agent-registry | `5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7` | [view](https://explorer.solana.com/address/5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7?cluster=devnet) |
| agent-wallet-factory | `AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in` | [view](https://explorer.solana.com/address/AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in?cluster=devnet) |
| dpo2u-compliance-verifier (SP1 v6) | `5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW` | [view](https://explorer.solana.com/address/5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW?cluster=devnet) |

## What to review first (suggested order)

1. **`sp1-solana/verifier/src/lib.rs`** — the v6 envelope parser and the 5-public-input Groth16 check
   that is the cryptographic core of the whole system. ~196 LOC. If this is wrong, nothing else matters.
2. **`solana-programs/programs/compliance-registry/src/lib.rs`** — how a verified attestation is
   produced: CPI to the verifier with proof bytes in `instruction_data`, commitment equality check,
   then `Attestation` PDA init. 319 LOC.
3. **`solana-programs/programs/consent-manager/src/lib.rs`** — DPDP §6(4) right-to-withdraw is
   enforced on-chain: `revoke_consent` requires `require_keys_eq!(rec.user, ctx.accounts.user.key())`.
   Same ZK verified-path pattern as compliance-registry but with 4-part seed
   `[consent, user, fiduciary, purpose_hash]`.
4. **`solana-programs/programs/art-vault/src/lib.rs`** — MiCAR Art. 23/36 on-chain enforcement.
   Pyth feed with 60 s staleness cap, confidence interval, overflow-checked BPS math, circuit
   breaker. 598 LOC. Inline unit tests lines 541-596.
5. **`solana-programs/programs/fee-distributor/src/lib.rs`** — 70/20/10 atomic split via three
   SPL `transfer_checked` CPIs; mint + owner validation on all four ATAs.
6. **`zk-circuits/program/src/main.rs`** + **`zk-circuits/lib/src/lib.rs`** — the SP1 predicate and
   the 13-flag bitmap ABI. Note: constraints on the bitmap are enforced off-chain before the proof
   is generated; the circuit only commits to the values.

## Pontos que merecem olhar crítico

- **Trusted issuer coexistence**: `create_attestation` (legacy, no ZK) and `create_verified_attestation`
  (ZK-backed) are both exposed. Legacy path is kept for non-privacy use cases and for comparison
  benchmarking. Both paths write into the same `Attestation` account; the `verified` flag
  distinguishes them. Decision point: keep dual-path or collapse to ZK-only in v1.
- **`compliance-registry-pinocchio`** (489 LOC, raw Solana, no Anchor): parallel implementation kept
  for CU benchmarking vs the Anchor version. Not in the happy-path demo. Will be deprecated in v2.
- **`agent-registry.register_agent`** takes a `_permissions: u16` argument and always forces
  `PERM_READ`. Governance upgrade must go through `update_permissions`, which is gated by a hardcoded
  `ADMIN_PUBKEY` (`agent-registry/src/lib.rs:22`). Placeholder was replaced by the devnet deployer
  in a recent commit; **rotate to a multisig before any mainnet deploy**.

- **LGPD Art. 18 MCP tool**: `erase_attestation_payload` (new, `mcp-server/src/tools/onchain/erase-attestation-payload.ts`)
  composes `compliance-registry.revoke_attestation` with per-backend off-chain erasure guidance:
  IPFS returns a KEK-rotation path (CID is content-addressed, cannot be unpublished; blob is
  AES-256-GCM ciphertext so key rotation = effective erasure); Shadow Drive returns a delete-account
  path; `mock` returns a local-delete confirmation for CI. Response includes
  `lgpd.{article, commitmentPreserved, piiRecoverable}` so callers can assert semantics
  programmatically. Covered by an 8-case unit suite.

- **Anchor 0.31.1 macro lint noise**: each program's `lib.rs` carries
  `#![allow(deprecated, unexpected_cfgs)]` with an inline note pointing at the post-Colosseum
  anchor-lang 0.32+ upgrade. Build output is clean (0 warnings); the suppressions only silence
  macro-generated lint noise that has no runtime impact.
- **`art-vault.pyth_price`** is an `AccountInfo` without an address constraint
  (`art-vault/src/lib.rs:404`). Safe because the authority is a `Signer`, the Pyth SDK validates
  the account owner internally, and staleness/confidence/sign checks are enforced. Open question:
  pin a specific feed address in a const to harden further.
- **`scripts/unblock-audit.sh`** is a host-side disk cleaner (caches only). Lives in the repo for
  ops continuity; not part of the hackathon artifact.

## Canonical compliance pipeline

The DPO2U protocol declares eight stages in normative order:

```
1. DISCOVER    → map_data_flow
2. AUDIT       → audit_infrastructure, check_compliance, calculate_privacy_score, audit_micar_art
3. ASSESS      → assess_risk, simulate_breach, compare_jurisdictions
4. REMEDIATE   → automated_remediation, generate_retention_policy, register_retention_policy_onchain
5. DOCUMENT    → generate_dpia_stored, generate_audit_stored, encrypted_reporting (→ IPFS CID)
6. PROVE       → zk_compliance_attest (SP1 v6 Groth16, 356B proof + 32B commitment)
7. REGISTER    → submit_verified_compliance_attestation (CPI to SP1 verifier, writes PDA)
8. ERASE *(on-demand)* → erase_attestation_payload, submit_consent_revoke
```

Source of truth: `DPO2U/packages/mcp-server/src/pipeline.ts` + `docs/PIPELINE.md`. Exposed at
runtime through the MCP tool `describe_pipeline` — a client that calls it first, with or without
a stage filter, gets the graph directly from the server and doesn't have to infer workflow from
tool names. Stages 1–7 are a linear lifecycle; stage 8 is event-driven and runs on-demand when a
data subject invokes the right to erasure.

The pipeline is **declarative in v1** (the server does not yet refuse out-of-order calls). Adding
a `prerequisites` field per tool schema and an `run_compliance_e2e` orchestrator is tracked as
open question below.

## Open questions (scope boundary v1 vs v2)

- **Governance multisig (Squads)**: `ADMIN_PUBKEY` is currently a single pubkey pointing at the
  devnet deployer. Keeping single-sig for v1 is a conscious call — the treasury isn't live on
  mainnet yet, so a multisig without liquid TVL would be ceremonial. Squads setup happens when
  mainnet treasury lands.
- **SP1 prover in CI**: end-to-end tests default to `SP1_USE_FIXTURE_PROOF=true` (uses the
  committed `proof.bin` fixture); live prove is gated by `LIVE_PROVE=1` for nightly opt-in.
  Rationale: a real prove is ~25 min per run — too heavy for every PR. Nightly catches VK drift;
  the fixture suite catches logic regressions. If you want a different ratio, flag it.
- **Trusted issuer vs ZK-verified dual-path**: `create_attestation` (legacy, no ZK) and
  `create_verified_attestation` (ZK-backed) are both exposed deliberately. The legacy path covers
  non-privacy use cases where a public DPIA or audit report is being anchored — ZK overhead buys
  nothing there. The `verified` flag distinguishes them on-chain. Keeping dual is a design
  decision, not tech debt.
- **`compliance-registry-pinocchio`** (489 LOC, raw Solana): kept for CU benchmarking against the
  Anchor variant. Roadmap: collapse to Anchor-only post-Colosseum once the benchmark feeds into
  the optimization work.
- **Cloak bridge** (`apps/cloak-bridge`, v0.1.0-alpha): analyzer primitives + Cloak types only.
  CLI + examples land in v0.2. Not part of the hackathon artifact.
- **Pipeline enforcement** (v2): currently `describe_pipeline` declares the canonical order, but
  the MCP server does not refuse out-of-order calls. Adding a `prerequisites` field per tool
  schema + an `run_compliance_e2e(subject, scope, docs[])` orchestrator that walks the pipeline
  end-to-end ships post-Colosseum. Both require reconciling the `consumes`/`produces` vocabulary
  between tools whose shapes are heterogeneous today.
- **Midnight integration** (v2 roadmap): the MidnightDriver placeholder was removed from the
  shipping code. Midnight is a strategic direction for a v2 chain backend, not a current
  artifact. The `ComplianceChainClient` interface is kept chain-agnostic so an alternative
  backend can be added without touching callers.

## How to run the smoke test

```bash
# 1. Build (all programs, verifier, client SDK)
cd solana-programs && anchor build
cd ../sp1-solana/verifier && cargo build-sbf
cd ../../packages/client-sdk && pnpm install && pnpm build

# 2. Authenticate with the MCP server (OAuth PKCE loopback)
node packages/client-sdk/dist/bin/dpo2u-cli.js login

# 3. Submit a verified attestation end-to-end
node packages/client-sdk/dist/bin/dpo2u-cli.js attest \
  --proof zk-circuits/proofs/sample-v6.bin \
  --commitment "$(sha256sum zk-circuits/proofs/sample-v6.bin | cut -c1-64)"

# 4. Read back
node packages/client-sdk/dist/bin/dpo2u-cli.js fetch --commitment <same>

# 5. Run the Anchor integration suite (requires devnet access)
cd solana-programs && pnpm test
```

Alternative: the root-level `scripts/deploy-devnet.sh` rebuilds + redeploys + writes `docs/devnet-deployments.md`.

## Test evidence

See `docs/TEST-RESULTS.md` (generated fresh before this submission, same SHA).

## What I would push back on

Nothing critical. The items above that say "v1 or v2" are honest scope-boundary questions, not known
defects. The code is consistent about using `checked_*` arithmetic, `require_keys_eq!` / `Signer`
checks, Borsh-typed IDLs, and `/// CHECK:` annotations on every `AccountInfo`. There are no `unwrap()`
calls in on-chain code paths and no TODO/FIXME/XXX/HACK markers in the Anchor crates.
