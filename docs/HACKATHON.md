# Hackathon submission targets

## Primary target — Colosseum Frontier (global)

| Field | Value |
|---|---|
| **Event** | Colosseum Frontier (Q2 2026 cohort) |
| **Window** | April 6 — **May 11, 2026** |
| **Time remaining** | ~20 days from 2026-04-21 |
| **Grand prize** | $30,000 |
| **Standout teams pool** | $200,000 distributed across 20 teams ($10k each) |
| **Public Goods award** | $10,000 |
| **University award** | $10,000 |
| **Submission portal** | `arena.colosseum.org` (login required) |
| **Rules** | `colosseum.com/frontier` |

### Sponsors / ecosystem relevant to our stack

- **Arcium** — privacy / encrypted computation. Likely has a privacy-focused
  track or bounty relevant to `dpo2u-solana`. ⚠ **Action:** check Arcium's
  Frontier page for a specific track + cross-submit if exists.
- **Superteam** — regional partner (see below).
- **Phantom, Raydium, Coinbase, MoonPay, Privy, Metaplex** — likely have
  their own tracks (wallet UX, DEX, on-ramps, NFT, identity). Not directly
  adjacent to our ZK compliance story — skip unless time allows.

### ⚠ Action required — confirm registration status

Superteam BR's landing page mentions a submission-related date of
**April 21, 2026** (today). It's unclear if this is:
- A regional registration cutoff (passed)
- A submission deadline (contradicts Colosseum's May 11)
- Outdated scraped content

**Chairman must verify with Pedro Marafiotti (@kukasolana) on X/Discord
whether regional Superteam BR registration is still open.** If missed,
submit directly to Colosseum global — BR regional is a bonus multiplier,
not a blocker for the global pool.

## Secondary target — Superteam Brasil regional track (if open)

- **Platform**: `superteam.fun/earn/regions/brazil`
- **Type**: Regional bounties / tracks layered on top of global hackathon
- **Contact**: Pedro Marafiotti — https://x.com/kukasolana
- **Narrative angle**: first LGPD-native ZK compliance stack from Brazil;
  built chairman-solo with AI-agent coordination

## Submission checklist (serves both targets)

- [ ] Public GitHub repo with README hook in 15 seconds
- [ ] 2-minute demo video (YouTube unlisted OK)
- [ ] Pitch deck (5-8 slides, Google Slides view-only)
- [ ] Devnet deployment — 6 program IDs with clickable Explorer links
- [ ] CI badge green on latest commit
- [ ] TEAM.md with chairman + AI-agent attribution + Superteam BR ack
- [ ] LICENSE + clear project description
- [ ] Live demo link OR reproducible `cargo run` path (we have the latter)

## Narrative positioning

Audience: judges + Superteam BR + Arcium team (if privacy track exists).

**30-second hook:**
> "LGPD exige audit de compliance. Mas pra provar compliance, auditor
> precisa ver o score real — violando privacidade de negócio. dpo2u-solana
> resolve: prova zero-knowledge de `score ≥ threshold` verificada on-chain
> em ~156k CU (~$0.0002). Primeiro stack ZK-LGPD do ecossistema Solana.
> SP1 v6 patch upstream-worthy. Built BR, primeiro do Brasil."

**30-second differentiation:**
- NOT generic ZK — LGPD-specific semantics (Brazilian market positioning)
- Real on-chain pairing — not mocked, not simulated (Sprint 4c proof)
- SP1 v6 support — we had to patch the upstream sp1-solana verifier
  ourselves; ~120 LOC, backward-compatible, upstream PR ready
- Chairman-solo shipped — end-to-end SP1 circuit + 5 Anchor programs +
  CPI integration + tests + devnet deploy in a short cycle with AI-agent
  coordination (proof that the model works)

## Day-of rehearsal checklist

- [ ] Clone the repo fresh on a second machine, run `cargo run -p dpo2u-driver --release -- --verbose` — confirm it works without any setup
- [ ] Open Solana Explorer links from README — all load
- [ ] Watch the demo video start to finish — audio/video/captions OK
- [ ] Re-read the README out loud in under 90 seconds — understandable?
- [ ] Check recent-commits — no WIP or placeholder text visible
