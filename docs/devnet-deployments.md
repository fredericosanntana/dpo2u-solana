# Devnet deployments — 14 programs live

> **Canonical source**: `solana-programs/Anchor.toml [programs.devnet]` (in this repo) and the [`STATUS.md`](https://github.com/fredericosanntana/DPO2U/blob/main/STATUS.md) generator in the DPO2U meta-repo. Last refresh: 2026-05-11.

## Batch 1 — 2026-04-21 (initial deploy, 6 programs)

| Program | Program ID | Explorer |
|---|---|---|
| `compliance_registry` | `7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK` | [view](https://explorer.solana.com/address/7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK?cluster=devnet) |
| `agent_registry` | `5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7` | [view](https://explorer.solana.com/address/5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7?cluster=devnet) |
| `agent_wallet_factory` | `AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in` | [view](https://explorer.solana.com/address/AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in?cluster=devnet) |
| `fee_distributor` | `88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x` | [view](https://explorer.solana.com/address/88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x?cluster=devnet) |
| `payment_gateway` | `4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q` | [view](https://explorer.solana.com/address/4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q?cluster=devnet) |
| `dpo2u_compliance_verifier` | `5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW` | [view](https://explorer.solana.com/address/5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW?cluster=devnet) |

## Batch 2 — Compliance / consent / MiCAR / AI-Verify

| Program | Program ID | Explorer |
|---|---|---|
| `consent_manager` | `D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB` | [view](https://explorer.solana.com/address/D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB?cluster=devnet) |
| `art_vault` (MiCAR Asset-Referenced Token) | `C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna` | [view](https://explorer.solana.com/address/C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna?cluster=devnet) |
| `aiverify_attestation` (IMDA AI-Verify) | `DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm` | [view](https://explorer.solana.com/address/DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm?cluster=devnet) |

## Batch 3 — Jurisdiction-specific primitives (Sprint D phase 1, 2026 Q2)

| Program | Program ID | Explorer |
|---|---|---|
| `popia_info_officer_registry` (South Africa) | `ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb` | [view](https://explorer.solana.com/address/ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb?cluster=devnet) |
| `ccpa_optout_registry` (California) | `5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk` | [view](https://explorer.solana.com/address/5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk?cluster=devnet) |
| `pipeda_consent_extension` (Canada) | `G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT` | [view](https://explorer.solana.com/address/G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT?cluster=devnet) |
| `pipa_korea_zk_identity` (Korea) | `41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR` | [view](https://explorer.solana.com/address/41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR?cluster=devnet) |

## Batch 4 — Composed Stack + Hiroshima ICOC (Sprint E/F + Composed Stack sprint, 2026-05-04 / 2026-05-08)

| Program | Program ID | Explorer |
|---|---|---|
| `compliance_registry_pinocchio` (Composed Stack orchestrator) | `FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8` | [view](https://explorer.solana.com/address/FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8?cluster=devnet) |
| `hiroshima_ai_process_attestation` (G7, 60 countries) | `4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx` | [view](https://explorer.solana.com/address/4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx?cluster=devnet) |

## Sample end-to-end attestation

A real verified attestation through `compliance_registry` → `dpo2u_compliance_verifier` CPI (SP1 v6 Groth16 verified on-chain):

- Attestation PDA: [`71b2EPzrDm4UbcatmPPhHmPAqQfzas38FnvyQp1tJ16c`](https://explorer.solana.com/address/71b2EPzrDm4UbcatmPPhHmPAqQfzas38FnvyQp1tJ16c?cluster=devnet)
- Submission tx: [`66J8DEZN...R9z2g`](https://explorer.solana.com/tx/66J8DEZNbZr3u6zxeoM5PZESDHa8mDy6UkpeYUiwLrNjAvsQMwfMcG2NyBUe2ZETUoTWJBHMGy5ctZhVdXYR9z2g?cluster=devnet)

## Operator wallet

DPO2U devnet operator: [`HjpGXPWQF1PiqjdWtNNEbAxqNamXKGpJspRZm9Jv5LZj`](https://explorer.solana.com/address/HjpGXPWQF1PiqjdWtNNEbAxqNamXKGpJspRZm9Jv5LZj?cluster=devnet) — pays rent & upgrade authority for all 14 programs above. Squads v4 multisigs (5 segregated vaults) are created and ready to take over as upgrade authority at mainnet deploy (see [`GOVERNANCE.md`](./GOVERNANCE.md)).
