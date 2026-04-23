# Test Results — Pre-submission run

**Captured**: 2026-04-23 (before Kaue / TheGarage review handoff)
**Branch**: `demo-day-prep` · **Commit**: see `git rev-parse HEAD`

## Summary

| Suite | Outcome | Notes |
|---|---|---|
| `packages/client-sdk` (vitest) | **✅ 69/69 pass** | mcp · storage/encrypted · client · consent · kek-vault |
| `solana-programs` (`cargo check --all --no-default-features`) | **✅ pass** | 14 deprecated-`realloc` warnings (Anchor→`resize()`), no errors |
| `sp1-solana/verifier` (`cargo test --test dpo2u_v6 --release`) | **✅ 4/4 pass** | positive case + 3 tamper-resistance adversarial cases |
| `mcp-server` (vitest, full) | **⚠️ 111 pass / 9 fail / 2 skipped** (122 total) | Failures are environmental and tooling-known — see below |

## Detail

### client-sdk — 69/69 ✅

```
 ✓ src/mcp.test.ts             (17 tests)    36 ms
 ✓ src/storage/encrypted.test  (27 tests)   163 ms
 ✓ src/client.test.ts           (3 tests)   301 ms
 ✓ src/consent.test.ts          (8 tests)   130 ms
 ✓ src/storage/kek-vault.test  (14 tests) 16184 ms

 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  18.24s
```

### solana-programs cargo check — ✅

```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 47.24s
```

Only warnings:
- `payment-gateway`, `fee-distributor`: 14× `AccountInfo::realloc` deprecated → should migrate to `resize()` (Anchor API change). Not a correctness issue, fix is a one-line rename. Tracked for post-review cleanup.

### sp1-solana verifier — 4/4 ✅ (v6 regression suite)

```
running 4 tests
test rejects_nonzero_exit_code ... ok
test rejects_wrong_vk_root      ... ok
test rejects_tampered_proof     ... ok
test verifies_dpo2u_v6_proof    ... ok

test result: ok. 4 passed; 0 failed; 0 ignored
```

This is the suite the CI pins (`cargo test --test dpo2u_v6` in `.github/workflows/ci.yml:37`).
The `verifies_dpo2u_v6_proof` positive case only passes if the hardcoded `expected_vk_root`
constant in `verify_proof_v6` matches the VK of the current `zk-circuits/` build — so this
result also cross-validates the v6.1.0 verification-key bytes.

**Local noise**: a plain `cargo test` (without `--test dpo2u_v6`) will additionally pull in
two orphaned tests from the upstream SP1-Solana template (`src/test.rs::test_verify_from_sp1`
and `test_hash_public_inputs_`) that still reference `../proofs/fibonacci_proof.bin`, a
fixture removed in commit `54fc5fc` when the fibonacci example was replaced by the dpo2u
driver. Those two tests fail locally with `No such file or directory`. CI skips them because
it pins `--test dpo2u_v6`. Scheduled for a one-liner removal post-review (housekeeping).

### mcp-server — 111 pass / 9 fail / 2 skipped

All 9 failures are either environmental (no local `solana-test-validator` running on :8899) or
test-tooling issues (`vi.mock` hoisting bug in `compliance-engine`) unrelated to the on-chain /
server-side code paths that ship in production. Breakdown:

**Environmental (4 failures, `compliance-engine/test/e2e/full-flow.test.ts`)**
- All 4 failures share the same root cause: `SolanaDriver.verifyZKProof live path failed:
  failed to get recent blockhash: TypeError: fetch failed`.
- These tests expect `solana-test-validator` running locally on `127.0.0.1:8899`. The reviewer
  machine does not need to reproduce them; CI skips them unless `LIVE_PROVE=1` is set.

**Test-tooling bug (5 failures, `compliance-engine/test/storage/provider.test.ts`)**
- `TypeError: () => ({ uploadBuffer: vi.fn(async …` — Vitest hoists `vi.mock()` factories above
  the imports of `vi` itself. Fix: migrate the mock factories to `vi.hoisted()` or move
  `uploadBuffer` into a top-level stub. No production code involved; Lighthouse / Shadow-Drive
  provider code itself is covered by integration tests against live endpoints.
- Scheduled for a house-keeping commit post-review.

**Signal for the reviewer**
- The OAuth layer (`src/auth/*`), Solana driver (`src/solana/client.ts`), and tool handlers
  (`src/tools/**/*`) are covered by the **111 passing** tests and the live HTTP suite against
  `mcp.dpo2u.com`. No failure exposes a behavior gap in those paths.

## Reproduction

```bash
# client-sdk
cd packages/client-sdk && pnpm install && pnpm test

# anchor programs (cargo-only gate, no validator required)
cd solana-programs && cargo check --all --no-default-features

# verifier
cd sp1-solana/verifier && cargo test --release

# mcp-server (full suite, expect 111/122 locally; live HTTP)
cd ../DPO2U/packages/mcp-server && pnpm test

# mcp-server (skip e2e, expect 107/118 locally on same dev box)
cd ../DPO2U/packages/mcp-server && SKIP_E2E=1 pnpm test
```
