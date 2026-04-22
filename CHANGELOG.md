# Changelog

All notable changes to `dpo2u-solana`.

## [unreleased] — `demo-day-prep` branch

Submission prep for Colosseum Frontier 2026 (deadline ~2026-05-11).

### Added — 2026-04-22 crypto gap closure

- **AES-256-GCM envelope storage backend** — new `EncryptedStorageBackend` at `packages/client-sdk/src/storage/encrypted.ts` wrapping any `StorageBackend` (mock/ipfs/shdw). Adds confidentiality-at-rest: payloads are encrypted client-side **before** upload; public gateways (Shadow Drive) see only ciphertext. Wire format: `[magic("DPO2U\x01") | nonce(12) | tag(16) | ciphertext]`. CLI flag `--encrypt-key <hex32>` added to both `attest` and `consent record` subcommands. CLI: `dpo2u-cli consent record` now also supports `--upload <file>`/`--backend`/`--shdw-storage-account` so the fiduciary can encrypt+upload+anchor in one call. 18 roundtrip + tamper-detection tests.
- **OpenFHE/TenSEAL validated live** — `dpo2u-openfhe` sidecar (port 3004) confirmed running in real crypto mode: `{mode:tenseal, scheme:CKKS, security_level:128, is_real_crypto:true, tenseal_available:true}`. End-to-end test: `encrypt(91.5) + encrypt(78.0)` → `homomorphic/add` → `decrypt` = **169.5** (CKKS batch slot 0). MCP server env already set `OPENFHE_USE_MOCK=false` — no config change needed. 7 FHE tools (`encrypted_reporting`, `private_benchmark`, `zk_compliance_proof`, `fhe_executive_dashboard`, `homomorphic_analytics`, `secure_data_sharing`, `automated_remediation`) run against real FHE pipeline.

### Added — 2026-04-22 cross-jurisdiction expansion (Frentes 1–4)

Based on Manus AI research (`00-INBOX/DPO2U Technical Deep-Dive & Implementation Roadmap 2026.md` + `Executive Summary_ Global Crypto and AI Regulatory Landscape 2026.md`). Four regulatory surfaces added pre-hackathon:

- **Frente 1 — India DPDP Consent Manager**. New program `consent-manager` (`D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB`) with `record_consent` / `record_verified_consent` (CPI SP1) / `revoke_consent`. PDA seeds `[b"consent", user, data_fiduciary, purpose_hash]`. Reuses compliance-registry's SP1 verifier ID — zero new crypto. 9 scaffold tests. TypeScript SDK: `DPO2UConsentClient` exported from `@dpo2u/client-sdk`. CLI subcommand: `dpo2u-cli consent record|revoke|query`. 8 SDK tests.
- **Frente 2 — MiCAR ART Vault (EU)**. New program `art-vault` (`C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna`) automating four MiCAR safeguards: Proof of Reserve (Art. 36), Liquidity Vault (Art. 39), Capital Buffer 3% (Art. 35), Velocity Limiter + Circuit Breaker (Art. 23). Instructions: `init_vault`, `update_reserve`, `mint_art`, `redeem_art`, `trip_circuit_breaker`. Oracle stubbed (reserve_amount is caller-asserted; Pyth wiring on roadmap per plan downgrade). 12 scaffold tests.
- **Frente 3 — AI Verify attestation (Singapore)**. New program `aiverify-attestation` (`DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm`) — single-purpose `attest_model` instruction storing `{model_hash, test_report_hash, vk_root, framework_code, operator, attested_at}` in PDA `[b"aiverify", model_hash]`. Global uniqueness per model_hash by design. 6 scaffold tests.
- **Frente 4 — Cross-jurisdiction MCP layer**. KB JSONs for 6 jurisdictions (LGPD/BR, GDPR/EU, DPDP/IN, MICAR/EU, PDPA/SG, UAE) under `dpo2u-mcp/src/kb/jurisdictions/`. Zod schema + loader + alias resolver (BR→LGPD, EU→GDPR, INDIA→DPDP, …). New MCP tools: `compare_jurisdictions`, `generate_adgm_foundation_charter`, `generate_consent_manager_plan`, `audit_micar_art`, `generate_aiverify_plugin_template`. Extended `check_compliance` with `jurisdiction` enum (DPDP/MICAR/PDPA/UAE return KB snapshot + pointer to compare_jurisdictions). 60+ new MCP tests.

Test totals: solana-programs **42/42 scaffold tests**, client-sdk **11/11 tests**, dpo2u-mcp **77/77 tests** (17 jurisdictions + 10 consent-plan + 12 audit-micar + 7 aiverify + 31 prior).

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
