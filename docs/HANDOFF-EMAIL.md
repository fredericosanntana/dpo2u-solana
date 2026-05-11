# Handoff email — draft

**Para**: Kaue
**Assunto**: [DPO2U] Review do stack Solana antes do Colosseum / TheGarage

---

Fala, Kaue!

Fechei a branch `demo-day-prep` do **dpo2u-solana** pronta pra tua
review. É o stack que vai pro Colosseum Frontier (11/Mai) — privacy-preserving
LGPD/GDPR/DPDP/MiCAR compliance attestation on Solana com SP1 Groth16 proofs.

**Repo**: https://github.com/fredericosanntana/solana (branch `demo-day-prep`)
**MCP live**: https://mcp.dpo2u.com (healthy, OAuth PKCE operational; Solana-only backend —
MidnightDriver placeholder foi removido, Midnight fica como v2 roadmap fora do código)

## Por onde começar

Manda ver nos três arquivos primeiro:

- `docs/REVIEW.md` — arquitetura, program IDs devnet com links Explorer,
  o que revisar primeiro, pontos que merecem olhar crítico, **seção nova
  "Canonical compliance pipeline"** (8 stages normativos expostos via tool
  MCP `describe_pipeline`), questões de scope v1 vs v2.
- `docs/TEST-RESULTS.md` — evidência: 69/69 client-sdk, 0 warnings anchor,
  6/6 sp1 verifier, 119 pass / 7 skip / 0 fail no mcp-server, 22/22 no
  compliance-engine.
- `DPO2U/packages/mcp-server/docs/PIPELINE.md` — spec normativa v1.0 do
  pipeline canônico (source of truth: `src/pipeline.ts`).

Depois, se tiver energia, os 5 arquivos core (em ordem):

1. `sp1-solana/verifier/src/lib.rs` — v6 envelope parser + Groth16 check
2. `solana-programs/programs/compliance-registry/src/lib.rs`
3. `solana-programs/programs/consent-manager/src/lib.rs`
4. `solana-programs/programs/art-vault/src/lib.rs`
5. `solana-programs/programs/fee-distributor/src/lib.rs`

## O que já sei que você vai perguntar

Já documentei em `docs/REVIEW.md` seção "Pontos que merecem olhar crítico"
e "Open questions":

- Trusted issuer vs ZK-verified paths coexistindo
- `compliance-registry-pinocchio` legacy raw Solana
- `ADMIN_PUBKEY` single-sig (trocado pra deployer devnet hoje; multisig
  antes de mainnet)
- `art-vault.pyth_price` sem address constraint (seguro, explicado no doc)
- LGPD Art. 18 erasure on-chain pronto, MCP tool surface em v2
- Cloak bridge em alpha (scaffold, não-blocker)

Qualquer push-back é bem-vindo. Preparado pra escopar o que fica em v1
vs v2 contigo.

Valeu,
Fred
