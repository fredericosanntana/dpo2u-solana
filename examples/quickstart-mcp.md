# DPO2U Quickstart — Claude Code / MCP

Setup em 3 passos. Não precisa escrever código.

## 1. Adicione o MCP server no Claude Code

Edite `~/.claude.json` (ou seu `claude_desktop_config.json`):

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

Reinicie o Claude Code. O servidor `dpo2u-compliance` passa a expor 25 tools (incluindo audit, docs generation, cross-jurisdiction, on-chain submit/fetch).

## 2. Skills DPO2U globais (opcional, recomendado)

4 skills já disponíveis como slash commands se você clonar o repo `dpo2u-solana` localmente e copiar `~/.claude/skills/dpo2u-*`:

| Skill | Trigger |
|---|---|
| `/dpo2u-consent-record` | "record/revoke/query DPDP India consent" |
| `/dpo2u-compliance-check` | "LGPD/GDPR/DPDP audit com scores" |
| `/dpo2u-audit-micar` | "MiCAR ART vault diagnóstico" |
| `/dpo2u-compare-jurisdictions` | "matriz regulatória 6 jurisdições" |

Copy rápido:
```bash
git clone https://github.com/fredericosanntana/dpo2u-solana --depth 1 /tmp/dpo2u-sk
cp -r /tmp/dpo2u-sk/.claude/skills/dpo2u-* ~/.claude/skills/
```

## 3. Teste com conversas naturais

**Exemplo A — Cross-jurisdictional decision:**
```
você:   Estou considerando abrir uma fundação ADGM pra minha DAO Solana.
        Me dá uma matriz comparando ADGM vs GDPR vs DPDP India.

claude: [invoca compare_jurisdictions] → tabela estruturada
        + recomendações + próximos passos
```

**Exemplo B — Record consent on-chain (sem código):**
```
você:   Registra consent de marketing pro user HthjMxo... na minha app DPDP India.

claude: [invoca submit_consent_record via MCP] → tx devnet + explorer link
```

**Exemplo C — Generate DPIA:**
```
você:   Empresa Acme BR processa dados de saúde (CPF + prontuário) pra seguro.
        Gera uma DPIA completa + anchor o hash on-chain.

claude: [invoca generate_dpia_stored] → DPIA markdown + IPFS CID
        → [invoca register_retention_policy_onchain] → attestation PDA
```

## Por que isso é interessante pra compliance officer

- **Não precisa de dev**. Você conversa, Claude executa.
- **Rastreável**. Toda chamada MCP loga; toda tx on-chain é pública.
- **Auditável**. O explorer URL vai pra sua pasta de evidência.
- **Determinístico**. `compare_jurisdictions` é lookup na KB, mesma resposta sempre.

## Debug / observabilidade

- Logs do MCP server: se você for admin, `docker logs dpo2u-mcp-server`
- Explorer: `https://explorer.solana.com/tx/{signature}?cluster=devnet`
- Tools list: `curl https://mcp.dpo2u.com/tools`
- OpenAPI: `https://mcp.dpo2u.com/openapi.json`
