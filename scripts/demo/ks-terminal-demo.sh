#!/bin/bash
# ks-terminal-demo.sh — runs the live KnightShield × DPO2U demo inside
# an xterm captured by xvfb+ffmpeg. Used by record-ks-demo.sh.

set -e
cd /root/dpo2u-solana
export NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules
export LOG_LEVEL=error
export LEANN_URL=http://127.0.0.1:65535
export NODE_ENV=development

# --- ANSI helpers ---
PROMPT() { echo -en "\033[1;38;5;208m\$\033[0m "; }   # terracotta $
CMD()    { echo -e "\033[1;37m$1\033[0m"; }            # bright white cmd
DIM()    { echo -e "\033[2m$1\033[0m"; }               # dim grey comment
HDR()    { echo -e "\033[1;38;5;208m$1\033[0m"; }      # terracotta header
OK()     { echo -e "\033[1;32m$1\033[0m"; }            # green
sleep 0.8
clear

HDR "━━━ DPO2U → KnightShield · multi-jurisdiction compliance attestation ━━━"
DIM   "github.com/Knight-Shield-Wallet/wallet-solana · Mobile Privacy Wallet on Solana · Frontier 2026 Cloak Track"
echo
sleep 2.5

# --- 1. Wallet check ---
PROMPT; CMD "solana balance"
sleep 0.4
solana balance
sleep 1.2

# --- 2. Multi-jurisdiction compliance scan + on-chain attestation ---
echo
DIM "# Real multi-jurisdiction scan via DPO2U engine — score visible, decision auditable"
PROMPT; CMD "npx tsx scripts/scan-knightshield-multi.ts"
sleep 0.8
# Filter: drop npm warnings, winston timestamp lines, JSON debug dumps from LEANN error spew
npx tsx /root/dpo2u-solana/scripts/scan-knightshield-multi.ts 2>&1 \
  | grep -v "^npm warn" \
  | grep -vE "^[0-9]{4}-[0-9]{2}-[0-9]{2}" \
  | grep -vE '^\s*"[0-9]+":' \
  | grep -vE '^\s*"service":' \
  | grep -vE '^\s*[{}]\s*$'

sleep 4
