# DPO2U Composed Stack — Demo Script

> **Audience**: Colosseum judges + Solana ecosystem reviewers
> **Length target**: 3–5 minutes
> **Prerequisites**: 1 browser tab on Solana Explorer (devnet) + 1 terminal
> **Devnet snapshot**: 2026-05-08

## One-line pitch

> "DPO2U: 4 atomic Solana primitives in a single transaction — Pinocchio orchestrator
> validates an SP1 ZK proof and writes to a Light Protocol compressed account
> ($0.032/op vs $0.34 LOCKED rent), referencing an immutable payload in Shadow Drive,
> governance trustless via Squads v4 across 5 segregated vaults. A stack that only
> composes atomically on Solana — on any EVM/L2 it becomes 4 separate protocols
> bridged together."

## Narrative beats (5 minutes)

### Beat 1 — The compliance moat (0:00–0:45)

> "Compliance audit trails grow without bound. LGPD, GDPR, MiCAR, DPDP, 14
> jurisdictions in DPO2U today. Each project we audit generates dozens of attestations
> over time. At ~$0.34 per regular Solana account in locked rent, audit trails at scale
> become uneconomic. Compressed accounts via Light Protocol drop that to ~$0.032 per
> attestation — and unlocks the moat we want for the institutional layer."

**Show**: `coverage` page on dpo2u.com — 17 jurisdiction badges (70+ countries) + AI Governance vertical (6 frameworks).

### Beat 2 — The 4-primitive composition (0:45–2:00)

> "We compose 4 Solana-native primitives in a single atomic transaction. Each one
> alone is interesting; composed atomically, they're impossible to replicate
> elsewhere."

| Primitive | Role |
|---|---|
| **Pinocchio** | Orchestrator — CU-efficient, no Anchor overhead, validates SP1 proof + drives 1 inner CPI |
| **Light Protocol** | Compressed leaf via `InvokeCpi` — Groth16 verified by `alt_bn128` syscalls |
| **Shadow Drive** | Immutable payload (DPIA, evidence) referenced by SHA-256 hash inside the leaf |
| **Squads v4** | 5 segregated vaults (Governance, Treasury, MiCAR Reserve, Compliance Authority, Emergency) — vault PDA is just a Pubkey to programs |

**Show**: open `programs/compliance-registry-pinocchio/src/lib.rs` — selectors 0x03/0x04
visible. Open `light_proto.rs` — Borsh structs + builder helpers.

### Beat 3 — Live devnet evidence (2:00–3:30)

Open Solana Explorer (devnet) + read the tx hashes:

**Pinocchio program (177 KB, deployed today)**:
- Program ID: `FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8`
- Deploy tx: `5FrSNTMKicroDWLyGnJ2UNDgAPvSkQFjBZoHu3Pb7H8pVSkx2n1ADgdpAoMvvtsg5SMztK4YqvRiFzsaqUPgiAid`

**5 Squads v4 multisigs (live multisig governance, today)**:
| Role | Multisig | Tx |
|------|----------|-----|
| Governance (3-of-5, 24h time-lock) | `BMet4bdb7nevhMztXXkHHhKXH4FQX7iwN5xJnA7NVrA7` | `2aopqXi5...nXcWJ` |
| Treasury (2-of-5) | `9r9A4PrroU3mrqf817YTYtQw3mKm4cbXtk4hJKArS9wD` | `5L3sYS1G...HrFpV` |
| MiCAR Reserve (2-of-5, 48h time-lock) | `ENdADWYsDJGnaCZYABLajaPqMaRmHP8guHjiEFAMFRYQ` | `4Ntpo6UC...HitHK` |
| Compliance Authority (2-of-5, 24h) | `9QatcwhuTZXRQamUV9kRAfumc2DNUWB63VhSpBYCTYaz` | `HfFjSzGL...HdJc8R` |
| Emergency (2-of-5, no time-lock) | `5jEkkVeKpJrwbxrydF6N4d8dfN2XQLhY5BRWv66QdnHR` | `3Wkx4XtJ...feHD5` |

**Smoke test (live)**:
```bash
$ npx tsx scripts/smoke-composed-flow.ts
Wallet: HjpGXPWQF1Pi... balance: 6.58 SOL
Compliance authority (Squads vault[3]): EXy2AQo53vEtQW1k3pjfQHQtxM3rDoU6PQdr9ARg4UiU
registered_program_pda: BvBoFqS13osGaGFkYwU4cnct7Hf62J9AUhMu6VEwTQjh
registered_program_pda account: NOT FOUND — Light registration prerequisite missing

Submitting tx... Program logs:
  Program log: dpo2u compliance v6 proof verified: 96 public-input bytes
  Program 5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW success
  Program log: verifier OK (compressed)
  Program FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8 failed: custom program error: 0x2006
```

**The story**:
- ✅ Pinocchio program receives selector `0x03 submit_verified_compressed`
- ✅ CPIs into SP1 Groth16 verifier (deployed at `5xrWphWX...`)
- ✅ ZK proof verified: 263k CU consumed, "verifier OK (compressed)"
- 🟡 Falls at `0x2006 LIGHT_CPI_FAILED` because `registered_program_pda` doesn't yet exist on-chain
- 🟡 That's the **only** missing piece: Light Foundation needs to register our program

### Beat 4 — The integration with Light Protocol (3:30–4:15)

> "We're not forking Light Protocol. We're integrating with the canonical upstream.
> Verified the wire format directly against `program-libs/compressed-account/src/discriminators.rs`
> and `programs/system/src/invoke_cpi/instruction.rs` on the Light main branch — including
> the `InvokeCpi` discriminator `[49, 212, 191, 129, 39, 194, 43, 196]`, the 11-account
> fixed prefix, and the 4-byte Vec length prefix in the wire format. Our `light_proto.rs`
> mirrors their Borsh structs verbatim."

**Show**: `light_proto.rs` next to upstream link. Mention issue:

> "Issue #2378 is open with Light Foundation: https://github.com/Lightprotocol/light-protocol/issues/2378
> — once they register `FZ21S53R...`, the smoke test passes E2E. Our wire format is green;
> we're literally one PDA materialization away from a working composed attestation."

### Beat 5 — Why this is uniquely Solana (4:15–5:00)

> "On any EVM L1 or L2 these would be 4 separate protocols bridged together with
> async messages. On Solana they compose atomically:
>
> - **`alt_bn128` precompiles** verify Groth16 in ~5–50k CU on-chain — EVM equivalents
>   either cost an order of magnitude more gas or require off-chain rollup tricks.
> - **Sub-second finality** means a compliance event is referenceable in the same block.
> - **Native composability of programs**: Squads vault PDA is just a `Pubkey` to our
>   program. Zero new code to govern. Compare to integrating Safe with N protocols.
> - **Pinocchio** runtime is Solana-native. Light Protocol itself migrated to Pinocchio.
>   The compute budget headroom is what enables the 4-primitive chain to fit in 1.4M CU.
>
> Solana is the only chain where this stack composes natively. Everywhere else you'd
> ship 4 products and 3 bridges — and explain to the regulator why those bridges are
> safe."

## Cost slide

| Mode | Per-op | Capital posture |
|------|--------|------------------|
| Regular `compliance-registry` (today, 14 program suite) | ~$0.34 | LOCKED in rent — never recovered for permanent attestations |
| **Composed flow (this sprint)** | **~$0.032** | Consumed; ledger tx fee + Groth16 verify |
| **Ratio** | **~10x cheaper per op + capital efficient** | Break-even ~25k attestations/year vs Helius Photon Pro |

## Live demo recipe (terminal)

```bash
# 1. Show wallet + balance
solana balance

# 2. Show Pinocchio deploy
solana program show FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8

# 3. Show one Squads multisig (e.g., Governance)
solana account BMet4bdb7nevhMztXXkHHhKXH4FQX7iwN5xJnA7NVrA7

# 4. Run the smoke test (intentionally fails at Light CPI gate)
npx tsx scripts/smoke-composed-flow.ts

# 5. Show MCP tool surface (310 tests green)
cd /root/DPO2U/packages/mcp-server && pnpm vitest run src/__tests__/composed-tools.test.ts

# 6. Show Photon empirical empty (waiting for Light registration)
HELIUS_API_KEY=$KEY npx tsx scripts/smoke-mcp-composed.ts
```

## Recording plan (asciinema or terminal screencast)

1. **Plan**: 4-minute recording, no editing, single terminal tab + browser.
2. **Setup**:
   ```bash
   asciinema rec /tmp/dpo2u-composed-stack.cast --title "DPO2U Composed Stack — devnet 2026-05-08"
   ```
3. **Scenes** (target 30–60s each):
   - `solana program show FZ21S53R...` — proof of deployed program
   - `cat scripts/squads-config.json | jq .multisigs` — proof of 5 multisigs
   - `npx tsx scripts/smoke-composed-flow.ts` — show SP1 success + Light gate
   - `npx tsx scripts/smoke-mcp-composed.ts` — Photon endpoint live, empty
   - Show `light_proto.rs` discriminator constant and wire format encode

4. **Browser tab in parallel** (for slot/links):
   - Solana Explorer (devnet) tab on `BMet4bdb...` (Squads Governance multisig)
   - Light Protocol issue #2378 tab open

5. **Voice over key points**:
   - "SP1 verify CPI works — `verifier OK (compressed)`"
   - "0x2006 is `LIGHT_CPI_FAILED` — exactly the documented gate"
   - "When Light registers `FZ21S53R...`, this same script passes E2E"

## Anticipated questions + answers

| Q | A |
|---|---|
| Why Squads with 5 separate multisigs vs 1? | Squads v4 stores `threshold` and `time_lock` per multisig (vault index segregates assets only). To apply different policies per role we run 5 independent multisigs. |
| Is your wire format guaranteed to match Light? | Verified against upstream `program-libs/compressed-account/src/discriminators.rs` + `instruction.rs` on commit main 2026-05-08. Drift risk is real — `light_proto.rs` has explicit "VALIDATION REQUIRED PRE-MAINNET" annotations. |
| When can you go to mainnet? | After: (a) Light registration on devnet → roundtrip green, (b) bench 1000 attestations validating cost, (c) Pinocchio audit (OtterSec/Neodyme, $15-30k), (d) 2 weeks devnet validation, (e) Squads upgrade authority transfer of all 14 programs. |
| What's actually "Solana-native" here vs another chain? | `alt_bn128` precompiles for cheap Groth16 verify; `compr6CU...` Account Compression for state scaling without rollup; Pinocchio's CU efficiency; Squads' Pubkey-as-authority composability. |
| Is the demo working today end-to-end? | SP1 verify chain: yes, 263k CU confirmed. Composed E2E: blocked at Light registration (issue #2378). Wire format up to that gate is verified. |

## Key URLs

- Repo: https://github.com/fredericosanntana/dpo2u-solana
- Light Protocol issue: https://github.com/Lightprotocol/light-protocol/issues/2378
- Pinocchio Solana Explorer: https://explorer.solana.com/address/FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8?cluster=devnet
- Strategic doc: `/root/DPO2U/06-Memory/Strategic/2026-05-08-composed-stack-sprint.md`
- Pitch source: this file
