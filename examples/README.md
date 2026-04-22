# DPO2U — Runnable Examples

Quickstarts copy-pasteable, zero fork do monorepo necessário. Todos usam pacotes publicados.

| File | Track | What it demonstrates |
|---|---|---|
| `quickstart-js.mjs` | A (JS/TS) | MCPClient: compare jurisdictions + submit consent on devnet + fetch |
| `quickstart-rust/` | B (Rust) | MCPClient async + PDA derivers + submit via MCP |
| `quickstart-rest.sh` | C (curl) | Pure HTTP — 5 endpoints em um script |
| `quickstart-mcp.md` | D (Claude Code) | Configurar MCP server + invocar skills |

Leia primeiro o [ONBOARDING.md](../ONBOARDING.md) na raiz — ele roteia você pro track certo baseado na sua stack.

## Pré-requisitos comuns

- Wallet Solana com saldo devnet: `solana airdrop 2 --url devnet` (ou https://faucet.solana.com)
- API key MCP: pegue em https://mcp.dpo2u.com ou abra issue com label `request-api-key`
- `export DPO2U_API_KEY=sua-jwt-key`
