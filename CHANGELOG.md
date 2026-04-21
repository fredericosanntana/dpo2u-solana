# Changelog

All notable changes to `dpo2u-solana`.

## [unreleased] — `demo-day-prep` branch

Submission prep for Colosseum Frontier 2026 (deadline ~2026-05-11).

### Added
- **Gap #1 — `create_verified_attestation`** instruction in
  `compliance-registry` that CPIs into `dpo2u-compliance-verifier`,
  ABI-decodes `PublicValuesStruct`, binds the attestation PDA to the
  proof's `subject_commitment`, and requires `meets_threshold == true`.
  Attestation struct now carries `verified: bool` and `threshold: u32`.
- **Gap #2 — `dpo2u-driver`** replaces the upstream fibonacci example.
  `cargo run -p dpo2u-driver --release -- --verbose` verifies a committed
  DPO2U proof on `solana-program-test` in ~30 seconds, no SP1 install.
- **Gap #3 — `@dpo2u/client-sdk`** TypeScript package with `DPO2UClient`
  (attestWithProof + fetchAttestation) and `dpo2u-cli` (commander-based).
  Auto-prepends `ComputeBudgetProgram.setComputeUnitLimit(400k)` to cover
  pairing-check + CPI overhead.
- **Gap #4 — SP1 v6 proof fixtures** committed at
  `sp1-solana/verifier/tests/fixtures/` so CI regression tests (4 cases:
  positive + tampered + non-zero exit + wrong vk_root) run without an
  external fetch step.
- **Integration test suite** — `solana-bankrun` loads both
  `compliance_registry.so` and `dpo2u_compliance_verifier.so` in-process
  and exercises the full CPI path (happy + 3 rejections). 4 new tests.
- **CI coverage expanded** — 6 jobs now: verifier-tests, sbf-build,
  anchor-check, zk-lib-check, **anchor-integration-tests** (pnpm test on
  solana-programs, 19 tests), **client-sdk-build** (pnpm test on client-sdk,
  3 tests).
- **`scripts/deploy-devnet.sh`** — idempotent deploy of 5 Anchor programs
  + SP1 verifier to devnet, auto-generates `docs/devnet-deployments.md`
  with Explorer links. Detects existing program IDs and upgrades instead
  of re-deploying.
- **`docs/DEMO.md`** scene-by-scene demo video script (asciinema + OmniVoice).
- **`docs/PITCH.md`** 6-slide pitch deck in Markdown (Marp-ready).
- **`docs/HACKATHON.md`** deadline + checklist + target hackathon tracks.
- **`TEAM.md`** chairman-solo + AI-agent coordination model.
- **Client SDK smoke tests** proving program ID table + PDA derivation
  match the canonical seeds across JS and Rust.

### Changed
- `Anchor.toml` default cluster flipped from `http://127.0.0.1:18899`
  (Sprint 4c localnet) to `devnet` for submission posture.
- Root `README.md` restructured as a hackathon pitch: 15-second hook,
  architecture diagram, novelty callout, reproducibility quickstart.
- `sp1-solana/README.md` rewritten — identifies as a DPO2U fork with v6
  patch, documents `verify_proof_v6` API contract, points at
  `dpo2u-driver` for live reproduction.
- `compliance-registry` Attestation account space expanded by 5 bytes
  to accommodate the new `verified` + `threshold` fields. Scaffolds
  budget test updated accordingly.
- `payment-gateway` + `fee-distributor` module docstrings now explicitly
  describe the scaffold nature and the v2 roadmap for SPL Token CPI
  migration (Gap #5 scoped as v2).

### Removed
- Upstream fibonacci example — `sp1-solana/example/sp1-program/`,
  `sp1-solana/example/script/build.rs`, `sp1-solana/proofs/fibonacci_proof.bin`.
- `inspector/` directory — half-implemented predicate-based compliance
  scaffold from an earlier architectural pivot. The concept is still
  alluded to in roadmap notes but no confusing dead code ships.
- Stale `solana-programs/package-lock.json` (pnpm-lock.yaml is the
  source of truth now).

### Fixed
- `sp1-solana/example/script` no longer references the non-existent
  `fibonacci-verifier-contract` crate.

### Security notes
- All `*-keypair.json` artifacts are gitignored via `**/*-keypair.json`
  rule in root `.gitignore` (verified with `git check-ignore`).
- SP1 v6 verifier pinned `vk_root` constant prevents circuit-version
  confusion attacks (documented in `sp1-solana/README.md`).
- compliance-registry verifier CPI target is **address-constrained** to
  the expected dpo2u-compliance-verifier program ID — a malicious caller
  cannot substitute a stub that always returns Ok.
