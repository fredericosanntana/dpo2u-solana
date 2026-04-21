# Pitch deck — 6 slides

Format: 6 slides, 30 seconds each = **3-minute pitch** (Colosseum demo day
length). Written as Markdown for easy conversion via
[Marp](https://marp.app) or manual Google Slides transcription.

---

## Slide 1 — Problem

### LGPD has a privacy paradox

Brazil's data protection law requires **every company** with a compliance
program to allow audits.

Audits require proving a **compliance score** meets a threshold.

But the score itself is **sensitive business data** — revealing it exposes
gaps, negotiation positions, and competitive intel.

> Five years after LGPD, ~50M CNPJs still can't audit-and-keep-private.

---

## Slide 2 — Solution

### Zero-knowledge compliance on Solana

```
Company (private):  score = 85
  ↓
SP1 zkVM proves:  "score ≥ 70"   →   Groth16 proof (356 B)
  ↓
Solana verifier:  alt_bn128 pairing   →   ~156k CU   →   $0.0002
  ↓
Compliance Registry:  Attestation PDA written — auditable, revocable, private
```

**Score stays private. Proof is public. Everything is enforceable on-chain.**

---

## Slide 3 — Live demo

```bash
$ git clone github.com/fredericosanntana/dpo2u-solana
$ cargo run -p dpo2u-driver -- --verbose
  ┌─ DPO2U compliance proof ─────────────────┐
  │ threshold           : 70                  │
  │ subject_commitment  : 0x0913644c...       │
  │ meets_threshold     : true                │
  │ proof size          : 356 bytes           │
  └───────────────────────────────────────────┘
  ✓ on-chain verification succeeded
  ✓ attestation PDA: 71b2EPzr... [Explorer↗]
```

No SP1 install. No validator setup. 60 seconds from clone to verified.

---

## Slide 4 — Tech novelty

### We patched `sp1-solana` for SP1 v6

| | Upstream | Our fork |
|---|---|---|
| SP1 versions | v2–v5 | v2–v5 **+ v6** |
| Envelope | 4 B selector | 4 B + 32 B exitCode + 32 B vkRoot + 32 B nonce |
| Public inputs | 2 | **5** |
| LOC added | — | ~120 |
| Backward compat | — | ✓ `verify_proof` untouched |

**Upstream PR ready to merge.** Regression suite: 4 tests, committed
fixtures, green CI.

---

## Slide 5 — Market & moat

- **LGPD surface:** ~50M CNPJs × ~annual compliance attestations
- **Cost:** $0.0002/attestation on Solana → feasible at regulatory volume
- **Ecosystem fit:** Arcium (privacy), Light Protocol (ZK), SP1 (zkVM)
- **Moat:** LGPD-native primitives (`did:br:cnpj:...`, threshold policies,
  DPO workflows) — not retrofitted from GDPR. First stack to ship this.
- **Unlock:** Cross-border compliance via proof portability — same ZK
  proof validates a Brazilian + European audit without revealing internals.

---

## Slide 6 — Team & roadmap

**Chairman-solo with AI-agent coordination.**

Frederico Santana (DPO2U Chairman) — architecture, strategy, integration.
Claude Code agents — implementation velocity under review.

**Shipped for this submission:**
- ✅ SP1 v6 patch (upstream PR-ready)
- ✅ 5 Anchor programs + Groth16 verifier, deployed on devnet
- ✅ 19 integration tests
- ✅ Committed fixture proof, 60-second reproduction

**Next 90 days:**
- SP1 Succinct Network prover integration (eliminate 32 GB RAM requirement)
- EVM mirror via Wormhole — same ZK proof, GDPR + LGPD simultaneously
- Solana Attestation Service interop
- Production pilot: 1 Brazilian enterprise + 1 regulator sandbox

---

### Thank you

**github.com/fredericosanntana/dpo2u-solana**

🇧🇷 *A gente sobe junto. Brasil vai ser o flagship market.*
