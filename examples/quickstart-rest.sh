#!/usr/bin/env bash
# DPO2U Quickstart — REST/curl track.
#
# Prereq:
#   export DPO2U_API_KEY="sua-jwt-key"
#
# Run:
#   bash quickstart-rest.sh
#
# What this does (5 REST calls, zero dependencies beyond curl + jq):
#   1. Health check
#   2. List all tools
#   3. Compare jurisdictions (onchain focus)
#   4. Audit a fixture MiCAR vault (in-memory, no RPC)
#   5. Submit a consent event on Solana devnet

set -e

ENDPOINT="${DPO2U_ENDPOINT:-https://mcp.dpo2u.com}"
API_KEY="${DPO2U_API_KEY:?set DPO2U_API_KEY}"
HDR=(-H "Content-Type: application/json" -H "x-api-key: $API_KEY")

section() { echo; echo "── $1 ──"; }

section "1. health"
curl -s "$ENDPOINT/health" | jq

section "2. tools list (count)"
curl -s "$ENDPOINT/tools" | jq '.tools | length'

section "3. compare_jurisdictions (onchain focus)"
curl -s -X POST "$ENDPOINT/tools/compare_jurisdictions" "${HDR[@]}" \
  -d '{"targetMarkets":["BR","EU","INDIA","SG","UAE"],"focus":"onchain"}' \
  | jq '.result.matrix[] | {code, country, target: .onChainOpportunity.target}'

section "4. audit_micar_art (in-memory fixture, MiCAR Art. 23/35/36/39)"
curl -s -X POST "$ENDPOINT/tools/audit_micar_art" "${HDR[@]}" \
  -d '{
    "vault": {
      "authority": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "reserveAmount": "1030000000",
      "outstandingSupply": "1000000000",
      "liquidityBps": 2000,
      "capitalBufferBps": 300,
      "dailyCap": "500000000",
      "dailySpent": "200000000",
      "lastResetDay": "0",
      "circuitTripped": false,
      "version": 1
    }
  }' \
  | jq '.result | {overallScore, modules: .modules | map_values(.ok), missingControls}'

section "5. submit_consent_record (real devnet tx, server wallet signs as fiduciary)"
# Use a random-looking devnet pubkey as demo user
DEMO_USER="HthjMxoioY59jwk22yALe2G35hvPSxhEBXWuymVVnmiJ"
curl -s -X POST "$ENDPOINT/tools/submit_consent_record" "${HDR[@]}" \
  -d "{\"user\":\"$DEMO_USER\",\"purposeCode\":1,\"purposeText\":\"rest_quickstart_demo\",\"storageUri\":\"\"}" \
  | jq '.result | {tx: .signature, pda: .consentPda, explorer: .explorerUrl}'

echo
echo "✓ 5 REST calls, including a real devnet tx. Check the explorer URL."
echo "  Full OpenAPI: $ENDPOINT/openapi.json"
echo "  Swagger UI:   $ENDPOINT/docs"
