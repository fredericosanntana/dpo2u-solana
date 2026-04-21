#!/usr/bin/env bash
# Deploy all 6 on-chain programs to devnet and record Explorer links.
#
# Prerequisites:
#   - solana-cli 3.1+ on PATH
#   - anchor 0.31.1 on PATH
#   - wallet at ~/.config/solana/id.json with ~50 SOL on devnet
#   - this script run from repo root: /path/to/dpo2u-solana
#
# Usage: ./scripts/deploy-devnet.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "─── DPO2U Solana Devnet Deploy ───"
echo "Repo root: ${REPO_ROOT}"
echo

# ── Sanity ────────────────────────────────────────────────────────────
solana config set -ud >/dev/null
BAL=$(solana balance 2>/dev/null | awk '{print $1}')
echo "Wallet: $(solana address)"
echo "Devnet balance: ${BAL} SOL"

if (( $(echo "${BAL} < 10" | bc -l) )); then
  echo "⚠  Low balance. SP1 verifier (~156 KB) + 5 Anchor programs need ~15-40 SOL."
  echo "   Run: solana airdrop 2 ; solana airdrop 2 ; solana airdrop 2"
  echo "   Or use https://faucet.solana.com if rate-limited."
  read -rp "Continue anyway? [y/N] " ans
  [[ "${ans}" =~ ^[Yy]$ ]] || exit 1
fi

# ── Build everything ─────────────────────────────────────────────────
echo
echo "─── Building Anchor programs ───"
cd "${REPO_ROOT}/solana-programs"
anchor build
ls target/deploy/*.so

echo
echo "─── Building SP1 verifier program ───"
cd "${REPO_ROOT}/sp1-solana"
cargo build-sbf --manifest-path example/program/Cargo.toml
ls target/deploy/dpo2u_compliance_verifier.so

# ── Deploy ──────────────────────────────────────────────────────────
DEPLOY_LOG="${REPO_ROOT}/docs/devnet-deployments.md"
{
  echo "# Devnet deployments — auto-generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "| Program | Program ID | Deploy tx | Explorer |"
  echo "|---|---|---|---|"
} > "${DEPLOY_LOG}"

deploy_program() {
  local name="$1"
  local so_path="$2"
  local keypair_path="$3"
  echo
  echo "─── Deploying ${name} ───"
  local pid
  pid=$(solana address -k "${keypair_path}")
  echo "Target program ID: ${pid}"

  local tx_out
  tx_out=$(solana program deploy "${so_path}" --program-id "${keypair_path}" 2>&1 | tee /dev/stderr)
  local tx
  tx=$(echo "${tx_out}" | grep -oE '[1-9A-HJ-NP-Za-km-z]{64,88}' | tail -1 || echo "UNKNOWN")

  echo "| ${name} | \`${pid}\` | \`${tx}\` | [view](https://explorer.solana.com/address/${pid}?cluster=devnet) |" >> "${DEPLOY_LOG}"
}

# Anchor programs
for prog in compliance_registry agent_registry agent_wallet_factory fee_distributor payment_gateway; do
  deploy_program \
    "${prog}" \
    "${REPO_ROOT}/solana-programs/target/deploy/${prog}.so" \
    "${REPO_ROOT}/solana-programs/target/deploy/${prog}-keypair.json"
done

# SP1 verifier program
deploy_program \
  "dpo2u_compliance_verifier" \
  "${REPO_ROOT}/sp1-solana/target/deploy/dpo2u_compliance_verifier.so" \
  "${REPO_ROOT}/sp1-solana/target/deploy/dpo2u_compliance_verifier-keypair.json"

echo
echo "─── Deploy complete ───"
echo "Deployment log: ${DEPLOY_LOG}"
echo
echo "Next: run smoke test with packages/client-sdk/bin/dpo2u-cli"
