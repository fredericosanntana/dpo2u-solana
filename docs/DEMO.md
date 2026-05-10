# Demo video script (2 minutes)

Target: ~2:00, hackathon judges + Superteam BR + potential Arcium track.
Language: **English** (global judges). Optional: record a PT-BR version
for Superteam BR regional track.

## Tooling

- Terminal capture: [`asciinema`](https://asciinema.org) → upload public unlisted
- Voice-over: OmniVoice TTS (local, DPO2U Chairman's voice) — already set up
  at `DPO2U/03-Ferramentas/Scripts/social/chairman_voice.py`. EN voice tag:
  `design:male,American accent,middle-aged,low pitch`. Use `--text` (not
  `--file` — file mode triggers LLM expansion that breaks duration).
- Final mix: ffmpeg overlay of asciinema-agg output + voiceover audio
- Hosting: YouTube unlisted (embeddable in README)

## Scene-by-scene

### 00:00–00:15 — Hook (voice over a Solana Explorer screenshot)

> "LGPD — Brazil's GDPR — says auditors must verify every company's
> compliance score. But the score itself is sensitive business data.
> For five years this contradiction has slowed audits to a crawl. Today
> we fix it with zero-knowledge proofs and Solana."

Visual: Solana Explorer showing a DPO2U attestation transaction detail,
CU consumed = ~156k, cost ~$0.0002.

### 00:15–00:35 — Architecture diagram (animated)

> "The company generates an SP1 Groth16 proof locally: 'score is greater
> than or equal to threshold'. The proof is 356 bytes. It ships to
> Solana. Our on-chain verifier runs a pairing check in roughly 156
> thousand compute units. If the proof holds, a compliance registry
> writes an attestation PDA. The score never leaves the company."

Visual: the README architecture diagram with animated flow from
`score (private)` → `SP1 zkVM` → `Groth16 proof` → `alt_bn128 syscall`
→ `Attestation PDA`.

### 00:35–01:30 — Live demo (asciinema, narrated)

Commands to record, one by one:

```bash
# 1) Clone fresh
git clone https://github.com/fredericosanntana/dpo2u-solana
cd dpo2u-solana

# 2) Verify a committed proof — Rust path, no SP1 install
cd sp1-solana
cargo run --release -p dpo2u-driver -- --verbose
# → shows proof summary, "pairing check passed on Solana runtime"

# 3) Run the Anchor integration tests (real CPI, real verifier)
cd ../solana-programs
pnpm install && pnpm test
# → 19 tests pass: scaffolds + verified-attestation happy path + 3 rejections
```

Narration (over the output):

> "Sixty seconds. No SP1 prover, no validator setup. Just cargo run
> loads our committed proof and verifies it against the real Solana
> runtime. The pairing succeeds. Then our integration tests run the
> full CPI path — 19 passing, including three negative cases proving
> we reject tampered proofs, mismatched commitments, and insufficient
> thresholds."

### 01:30–01:45 — Technical novelty callout

> "Under the hood: we patched the upstream sp1-solana verifier to
> support SP1 v6. One hundred twenty lines of Rust, backward compatible
> with v5. An upstream PR to Succinct Labs is ready to merge."

Visual: split screen — git diff of `sp1-solana/verifier/src/lib.rs`
highlighting `verify_proof_v6`, next to the v6 envelope byte layout from
the README.

### 01:45–02:00 — Close (Brazil + team)

> "Built from Brazil for Brazilian compliance. First LGPD-native ZK
> compliance stack on Solana. Chairman-solo, shipped with AI-agent
> coordination. Submitted to Colosseum Frontier 2026. Brazil flagship."

Visual: DPO2U logo → Superteam BR logo → Solana logo. Optional:
split-screen of Pedro Marafiotti's "Brasil vai ser o flagship market"
tweet if we can get permission.

## Production checklist

- [ ] Record asciinema casts for each block (retake if any typo)
- [x] Record voiceover in 5 chunks matching scene boundaries (2026-05-05; 114.54s total in `DPO2U/07-Content/hyperframes-dpo2u/colosseum-demo/narration/`)
- [ ] Draft architecture animation (Excalidraw or Motion Canvas)
- [ ] Mix audio + visuals in ffmpeg or Descript
- [ ] Burn-in captions (for silent-watch on Twitter/LinkedIn)
- [ ] Upload YouTube unlisted + embed in README `🎬 Demo` section
- [ ] Post as a Twitter thread with 30-sec clip (Arcium + Superteam BR tag)

## Fallback — text-only slideshow

If time collapses, a static README + annotated asciinema cast is
acceptable. Upload the `.cast` file to asciinema.org and embed in README.
