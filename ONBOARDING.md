# DPO2U — Onboarding para Devs

> Hello World em 5–10 min, em 4 stacks diferentes. Tudo rodando hoje em devnet. Mínima fricção — use pacotes publicados, sem clone do monorepo.

DPO2U é uma camada de compliance programática em Solana (LGPD/GDPR/DPDP/MiCAR/PDPA/UAE) com duas interfaces:
- **SDKs** (`@dpo2u/client-sdk` no npm, `dpo2u-sdk` em crates.io) para submeter atestações on-chain diretamente da sua stack.
- **MCP REST server** ([`mcp.dpo2u.com`](https://mcp.dpo2u.com)) para audit, geração de docs (DPIA, políticas), mapa cross-jurisdicional e FHE analytics — tudo via REST.

A partir da v0.2 (2026-04-22), **os SDKs também encapsulam o MCP REST** (`MCPClient`), então você tem on-chain + audit/docs com uma única dependência.

---

## Pick your path (4 tracks)

| Track | Para quem | Stack | Hello World | Tempo |
|---|---|---|---|---|
| **[A — JS/TS](#track-a--jsts-node-18)** | Web3 devs, dapps, backends Node | `npm i @dpo2u/client-sdk` | Record consent + gerar DPIA via MCPClient | ~8 min |
| **[B — Rust](#track-b--rust)** | Devs Anchor/Pinocchio, integradores on-chain | `cargo add dpo2u-sdk` | Derive consent PDA + comparar jurisdições via MCPClient | ~10 min |
| **[C — REST/curl](#track-c--rest-sem-sdk)** | Stacks não suportadas diretamente | `curl` | 3 endpoints: `/compare_jurisdictions`, `/audit_micar_art`, `/submit_consent_record` | ~3 min |
| **[D — Claude Code / MCP](#track-d--claude-code--mcp)** | AI builders, compliance officers | Add server no `.claude.json` + 4 skills | Invocar `/dpo2u-consent-record` ao vivo | ~5 min |

---

## Pré-requisitos comuns

- **Wallet Solana** com saldo devnet (devnet é grátis): `solana airdrop 2 --url devnet`
  - Se der rate limit, use https://faucet.solana.com (captcha, grátis)
- **API key MCP** — peça a sua no feedback form abaixo (ou veja seu token em `mcp.dpo2u.com`)
- **Node 18+** (Track A) OU **Rust 1.75+** (Track B) — os demais só precisam de `curl`

Todos os programas rodam em **devnet**: `compliance-registry`, `consent-manager`, `art-vault`, `aiverify-attestation`, etc. Program IDs em https://github.com/fredericosanntana/dpo2u-solana/blob/demo-day-prep/solana-programs/Anchor.toml.

---

## Track A — JS/TS (Node 18+)

```bash
mkdir dpo2u-hello && cd dpo2u-hello
npm init -y
npm install @dpo2u/client-sdk @solana/web3.js
```

Cria `hello.mjs`:

```js
import { MCPClient, DPO2UConsentClient } from '@dpo2u/client-sdk';
import { Keypair, Connection } from '@solana/web3.js';

// 1. Audit/docs via MCP (no keypair needed for most tools)
const mcp = new MCPClient({
  endpoint: 'https://mcp.dpo2u.com',
  apiKey: process.env.DPO2U_API_KEY, // pegue sua key no feedback form
});

const matrix = await mcp.compareJurisdictions({
  targetMarkets: ['BR', 'EU', 'INDIA', 'SG', 'UAE'],
  focus: 'onchain',
});
console.log(`Matrix: ${matrix.matrix.length} jurisdictions`);
matrix.matrix.forEach(j =>
  console.log(`  ${j.code} (${j.country}) → ${j.onChainOpportunity?.target ?? '-'}`)
);

// 2. On-chain consent record via MCP (server signs as fiduciary)
const demoUser = Keypair.generate();
const consent = await mcp.submitConsentRecord({
  user: demoUser.publicKey.toBase58(),
  purposeCode: 1,
  purposeText: 'marketing_communications',
});
console.log(`\nTx: ${consent.signature}`);
console.log(`PDA: ${consent.consentPda}`);
console.log(`Explorer: ${consent.explorerUrl}`);
```

```bash
export DPO2U_API_KEY="sua-jwt-key"
node hello.mjs
```

**Output esperado:**
```
Matrix: 5 jurisdictions
  LGPD (BR) → -
  GDPR (EU) → -
  DPDP (IN) → Consent Manager on Solana
  PDPA (SG) → AI Verify Seal of Trust
  UAE (AE) → DPO2U Foundation governance

Tx: 5w6GDq...
PDA: EM7VQW...
Explorer: https://explorer.solana.com/tx/5w6GDq...?cluster=devnet
```

**Para submeter on-chain com SUA wallet** (não via server), use `DPO2UConsentClient` diretamente — veja o [README do SDK](https://www.npmjs.com/package/@dpo2u/client-sdk).

---

## Track B — Rust

```bash
cargo new dpo2u-hello && cd dpo2u-hello
cargo add dpo2u-sdk --features mcp-client
cargo add tokio --features rt,macros
```

Substitua `src/main.rs`:

```rust
use dpo2u_sdk::{mcp::MCPClient, pdas, programs};
use solana_program::pubkey::Pubkey;
use std::str::FromStr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mcp = MCPClient::new(
        "https://mcp.dpo2u.com",
        std::env::var("DPO2U_API_KEY").ok(),
    );

    // 1. Cross-jurisdiction matrix
    let matrix = mcp.compare_jurisdictions(
        Some(vec!["BR".into(), "EU".into(), "INDIA".into()]),
        Some("onchain"),
    ).await?;
    println!("Matrix: {} jurisdictions", matrix.matrix.len());
    for j in &matrix.matrix {
        println!("  {} ({}) — {}", j.code, j.country,
            j.on_chain_opportunity.as_ref().map(|o| o.target.as_str()).unwrap_or("-"));
    }

    // 2. Derive a consent PDA (local, no RPC) — useful if you want to CPI from your program
    let user = Pubkey::new_unique();
    let fiduciary = Pubkey::new_unique();
    let purpose_hash = pdas::purpose_hash(b"marketing_communications");
    let (consent_pda, _bump) = pdas::consent_pda(&user, &fiduciary, &purpose_hash);
    println!("\nDerived consent PDA: {}", consent_pda);
    println!("Program ID: {}", programs::CONSENT_MANAGER);

    // 3. Submit via MCP (server wallet signs as fiduciary)
    let rec = mcp.submit_consent_record(
        &user.to_string(),
        1,
        "marketing_communications",
        None, None,
    ).await?;
    println!("\nTx: {}", rec.signature);
    println!("PDA: {}", rec.consent_pda);
    println!("Explorer: {}", rec.explorer_url);

    Ok(())
}
```

```bash
export DPO2U_API_KEY="sua-jwt-key"
cargo run
```

Para integrar via **CPI no seu programa Anchor**, veja o [README do crate](https://docs.rs/dpo2u-sdk).

---

## Track C — REST (sem SDK)

Tudo acessível via `curl` contra [mcp.dpo2u.com](https://mcp.dpo2u.com). Use [Swagger UI](https://mcp.dpo2u.com/docs) pra explorar interativamente.

```bash
# 1. Health (sem auth)
curl -s https://mcp.dpo2u.com/health | jq

# 2. Compare jurisdictions (com auth)
curl -s -X POST https://mcp.dpo2u.com/tools/compare_jurisdictions \
  -H "Content-Type: application/json" \
  -H "x-api-key: $DPO2U_API_KEY" \
  -d '{"targetMarkets":["BR","EU","INDIA"],"focus":"onchain"}' \
  | jq '.result.matrix[] | {code, country, onChainOpportunity: .onChainOpportunity.target}'

# 3. Audit MiCAR ART vault (in-memory example)
curl -s -X POST https://mcp.dpo2u.com/tools/audit_micar_art \
  -H "Content-Type: application/json" \
  -H "x-api-key: $DPO2U_API_KEY" \
  -d '{"vault":{"authority":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU","reserveAmount":"1030000000","outstandingSupply":"1000000000","liquidityBps":2000,"capitalBufferBps":300,"dailyCap":"500000000","dailySpent":"200000000","lastResetDay":"0","circuitTripped":false,"version":1}}' \
  | jq '.result.overallScore, .result.modules'

# 4. On-chain consent record (server signs)
curl -s -X POST https://mcp.dpo2u.com/tools/submit_consent_record \
  -H "Content-Type: application/json" \
  -H "x-api-key: $DPO2U_API_KEY" \
  -d '{"user":"HthjMxoioY59jwk22yALe2G35hvPSxhEBXWuymVVnmiJ","purposeCode":1,"purposeText":"marketing"}' \
  | jq '.result | {tx: .signature, pda: .consentPda, url: .explorerUrl}'

# 5. Fetch consent
curl -s -X POST https://mcp.dpo2u.com/tools/fetch_consent_record \
  -H "Content-Type: application/json" \
  -H "x-api-key: $DPO2U_API_KEY" \
  -d '{"user":"HthjMxoio...","dataFiduciary":"<SERVER_WALLET>","purposeText":"marketing"}' \
  | jq '.result.record'
```

OpenAPI spec completo: https://mcp.dpo2u.com/openapi.json (25 endpoints).

---

## Track D — Claude Code / MCP

**1. Adicione o servidor MCP ao Claude Code** em `~/.claude.json`:

```json
{
  "mcpServers": {
    "dpo2u-compliance": {
      "url": "https://mcp.dpo2u.com",
      "type": "http",
      "headers": {
        "Authorization": "Bearer SEU_API_KEY"
      }
    }
  }
}
```

**2. Skills DPO2U já registradas globalmente** (`~/.claude/skills/dpo2u-*`):
- `/dpo2u-consent-record` — record/revoke/query consent on-chain
- `/dpo2u-compliance-check` — LGPD/GDPR/DPDP audit com scores
- `/dpo2u-audit-micar` — MiCAR ART vault diagnóstico
- `/dpo2u-compare-jurisdictions` — matriz regulatória + gera charter ADGM

**3. Exemplo de conversa:**

```
você: /dpo2u-compare-jurisdictions focus:onchain markets: [BR, EU, INDIA, SG]
claude: [invoca tool] → matrix com on-chain opportunities por jurisdição

você: /dpo2u-consent-record user: <pubkey> purpose: marketing
claude: [invoca submit_consent_record via MCP] → tx devnet + PDA
```

Vantagem: **não precisa escrever código** — Claude Code é a interface natural pra compliance officers / non-devs.

---

## O que construir (ideias)

1. **Integre consent no seu RWA/DeFi protocol** — antes de permitir transfer/swap, verifique via `fetch_consent_record` se o user deu consent pra "financial_services_marketing" ou similar.
2. **Gere DPIAs automaticamente** no seu pipeline — a cada novo feature flag, chame `generate_dpia_stored` e anchor via `register_retention_policy_onchain`.
3. **MiCAR-ready stablecoin** — use `art-vault` program + `audit_micar_art` tool no seu oracle monitoring pra alertar quando PoR cai.
4. **AI Verify para seu modelo ML** — `generate_aiverify_plugin_template` dá scaffold Python; anchor via `aiverify-attestation` program.
5. **ADGM DLT Foundation** — se você tá montando uma DAO, `generate_adgm_foundation_charter` dá template pra enviar ao counsel.

---

## Feedback (queremos sua validação!)

Abra uma issue no GitHub usando o template "DPO2U Dev Feedback":
- https://github.com/fredericosanntana/dpo2u-solana/issues/new?template=devs-feedback.md

Ou mande direto: `contact@dpo2u.com`.

**O que mais ajuda**:
- O que você TENTOU fazer?
- O que funcionou sem fricção?
- Onde travou (erro exato, stack, tempo gasto)?
- O que faltou no SDK/docs pra você shippar?

---

## Transparência: gaps conhecidos

Estamos validando em público. Honest gaps documentados em [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md#8-honest-gaps--roadmap):

- **Pyth oracle `art-vault`**: `update_reserve_from_pyth` funciona, mas ainda precisa validação mainnet contra feed real.
- **AI Verify toolkit**: template Python pronto; integração real com `aiverify-test-engine` fica ao dev que quiser testar.
- **Pinocchio ports**: programas novos (consent-manager, art-vault, aiverify) estão em Anchor; ports Pinocchio planejadas v2 pós-hackathon (−54% CU wrapper, −74% `.so` size).
- **DPB India Consent Manager registration**: burocracia off-chain pendente (`generate_consent_manager_plan` dá o checklist).

---

_Atualizado 2026-04-22 · dpo2u-solana `demo-day-prep` · SDKs v0.2.0 · MCP 25 paths_
