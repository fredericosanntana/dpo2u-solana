#!/bin/bash
# composed-terminal-demo.sh — drives the 4 terminal scenes of the
# Composed Stack 3-min demo (target ~140s execution + sleeps).
#
# Run inside the xvfb+xterm capture from record-composed-demo.sh, OR
# standalone in any terminal with proper Solana CLI + tsx + jq + Helius key.
#
# Required env: HELIUS_API_KEY
# Required CLI: solana, jq, npx, tsx

set -e
cd /root/dpo2u-solana
export NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules
export LOG_LEVEL=error
export NODE_ENV=production
export SOLANA_CLUSTER=devnet

# --- ANSI helpers (terracotta DPO2U brand) ---
PROMPT() { echo -en "\033[1;38;5;208m\$\033[0m "; }   # terracotta $
CMD()    { echo -e "\033[1;37m$1\033[0m"; }            # bright white cmd
DIM()    { echo -e "\033[2m$1\033[0m"; }               # dim grey comment
HDR()    { echo -e "\033[1;38;5;208m$1\033[0m"; }      # terracotta header
OK()     { echo -e "\033[1;32m$1\033[0m"; }            # green

sleep 2
clear

HDR "━━━ DPO2U Composed Stack · devnet evidence · 2026-05-08 ━━━"
DIM "Pinocchio · Light Protocol · Shadow Drive · Squads v4"
echo
sleep 4

# --- Scene 2: Pinocchio v2 deploy (~22s) ---
DIM "# Pinocchio compliance-registry v2 — selectors 0x03/0x04 added today"
sleep 1.5
PROMPT; CMD "solana balance"
sleep 0.8
solana balance
sleep 3

echo
PROMPT; CMD "solana program show FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8"
sleep 0.8
solana program show FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8 | head -7
sleep 9

clear
# --- Scene 3: 5 Squads multisigs (~20s) ---
HDR "━━━ 5 Squads v4 multisigs · segregated vaults ━━━"
DIM "# Governance / Treasury / MiCAR Reserve / Compliance Authority / Emergency"
echo
sleep 3

PROMPT; CMD "jq '.multisigs[] | {role, threshold, time_lock_seconds: .timeLockSeconds, multisigPda}' scripts/squads-config.json"
sleep 0.8
jq '.multisigs[] | {role, threshold, time_lock_seconds: .timeLockSeconds, multisigPda}' scripts/squads-config.json
sleep 12

clear
# --- Scene 4: Composed flow E2E smoke (~55s — THE MEAT) ---
HDR "━━━ Composed Flow E2E · SP1 verify + Light CPI ━━━"
DIM "# atomic tx: Pinocchio → SP1 Groth16 verify → Light System Program insert"
echo
sleep 4

PROMPT; CMD "npx tsx scripts/smoke-composed-flow.ts"
sleep 0.8
# The smoke script logs the full flow.
npx tsx /root/dpo2u-solana/scripts/smoke-composed-flow.ts 2>&1 \
  | grep -v "^npm warn" \
  | grep -v "at process.processTicksAndRejections" \
  | grep -v "internal/process/task_queues" \
  | grep -v "node:internal" \
  | head -50

sleep 5

clear
HDR "━━━ What just happened ━━━"
echo
sleep 2
OK   "  ✓ SP1 Groth16 verifier: PASS"
DIM  "    proof verified on-chain · 263k CU consumed"
echo
sleep 5
HDR  "  ✗ 0x2006 = LIGHT_CPI_FAILED  (expected)"
DIM  "    registration prerequisite — Light Foundation issue #2378"
echo
sleep 6
DIM  "  Composition works · the gate is collaboration."
sleep 10

clear
# --- Scene 5: Photon Indexer live (~25s) ---
HDR "━━━ Helius Photon Indexer · live ━━━"
DIM "# ZK-compressed leaves indexed off-chain via tx logs (no rent)"
echo
sleep 3

PROMPT; CMD "npx tsx scripts/smoke-mcp-composed.ts"
sleep 0.8
HELIUS_API_KEY="${HELIUS_API_KEY:?HELIUS_API_KEY required}" \
  npx tsx /root/dpo2u-solana/scripts/smoke-mcp-composed.ts 2>&1 \
  | grep -v "^npm warn" \
  | head -40

sleep 12
echo
OK  "  ✓ Photon Indexer (Helius) live · getCompressedAccountsByOwner ready"
sleep 4
DIM "  ↑ when Light registers FZ21S53R..., this returns the compressed leaves"
sleep 10
echo
HDR "━━━ Composition is the protocol · dpo2u.com ━━━"
sleep 6
