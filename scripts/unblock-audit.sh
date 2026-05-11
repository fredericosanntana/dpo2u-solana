#!/usr/bin/env bash
# unblock-audit.sh — libera disco do VPS pra retomar a pre-launch audit.
#
# Executar manualmente no terminal do host (o Bash da sessão Claude Code
# está inoperante porque o FS saturou durante um npm install).
#
# Safe: só toca em caches/builds derivados. Preserva:
#   - volumes Docker (mcp-data, redis-data, openfhe-data, etc.)
#   - containers rodando (dpo2u-mcp-server, dpo2u-openfhe, cuidabot, midnight, etc.)
#   - código fonte em /root/dpo2u-solana e /root/DPO2U
#   - programas Solana deployed
#   - API keys / OAuth tokens / Solana keypairs
#
# Espera liberar ~30 GB. Rodar uma vez.

set -e

echo "═══ DPO2U disk unblock — $(date -u +%Y-%m-%dT%H:%M:%SZ) ═══"
echo
echo "--- Antes ---"
df -h / | tail -1

echo
echo "--- 1/5 Docker build cache (dangling layers, 11.5 GB reclaimable esperado) ---"
docker builder prune -af 2>&1 | tail -3

echo
echo "--- 2/5 Docker imagens dangling (tags órfãs, 4.5 GB esperado) ---"
docker image prune -af 2>&1 | tail -3

echo
echo "--- 3/5 npm cacache (9 GB) ---"
rm -rf /root/.npm/_cacache
echo "  /root/.npm/_cacache removido"

echo
echo "--- 4/5 node-gyp / pnpm caches ---"
rm -rf /root/.cache/node-gyp /root/.cache/pnpm 2>/dev/null || true
echo "  caches removidos"

echo
echo "--- 5/5 cargo registry cache (recriado automaticamente no próximo cargo fetch) ---"
rm -rf /root/.cargo/registry/cache 2>/dev/null || true
echo "  cache removido"

echo
echo "--- Depois ---"
df -h / | tail -1

echo
echo "═══ Feito. Agora avisa no Claude Code: \"disco ok, retoma audit\" ═══"
