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

Six programs are live on devnet, end-to-end smoke test passes, and the full OAuth + MCP tool surface
is reachable at `mcp.dpo2u.com`.

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
  `ADMIN_PUBKEY` (`agent-registry/src/lib.rs:20`). Placeholder was replaced by the devnet deployer
  in the latest commit; **rotate to a multisig before any mainnet deploy**.
- **`art-vault.pyth_price`** is an `AccountInfo` without an address constraint
  (`art-vault/src/lib.rs:404`). Safe because the authority is a `Signer`, the Pyth SDK validates
  the account owner internally, and staleness/confidence/sign checks are enforced. Open question:
  pin a specific feed address in a const to harden further.
- **`scripts/unblock-audit.sh`** is a host-side disk cleaner (caches only). Lives in the repo for
  ops continuity; not part of the hackathon artifact.

## Open questions (scope boundary v1 vs v2)

- **Governance**: ADMIN_PUBKEY is a single pubkey. v1 scope or move to Squads multisig now?
- **SP1 prover in CI**: end-to-end tests use `SP1_USE_FIXTURE_PROOF=true` to skip prove. Live prove
  is gated by `LIVE_PROVE=1`. How deep does TheGarage want the live-prove variant in CI?
- **LGPD Art. 18 erasure** (merged 2026-04-22): storage backends pluggable (`mock`, `ipfs`, `shdw`);
  on-chain erasure emits a tombstone. **MCP tool surface for erase/attest** is not exposed yet —
  reachable only via direct program call. Ship MCP tool in v1 or v2?
- **Cloak bridge** (`apps/cloak-bridge`, v0.1.0-alpha): analyzer primitives + Cloak types. CLI +
  examples land in v0.2. Out of hackathon scope, not blocking the submission.

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
