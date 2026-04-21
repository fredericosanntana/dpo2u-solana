#!/usr/bin/env bash
# Deploy all 6 on-chain programs to devnet and record Explorer links.
#
# Prerequisites:
#   - solana-cli 3.1+ on PATH
#   - anchor 0.31.1 on PATH
#   - wallet at ~/.config/solana/id.json with enough SOL on devnet
#     (~15-20 SOL covers the SP1 verifier + 5 Anchor programs)
#   - run from repo root
#
# Idempotent: if a program is already deployed at the target ID, the script
# does a program upgrade instead of a fresh deploy. Fails loud if the wallet
# is not the upgrade authority.
#
# Usage: ./scripts/deploy-devnet.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# ── Balance check (no bc dependency) ─────────────────────────────────
solana config set -ud >/dev/null
WALLET="$(solana address)"
BAL_RAW="$(solana balance 2>/dev/null || echo '0 SOL')"
BAL_INT="${BAL_RAW%%.*}"   # strip decimals — "17.123 SOL" → "17"
BAL_INT="${BAL_INT%% *}"   # strip " SOL" suffix

echo "─── DPO2U Solana Devnet Deploy ───"
echo "Wallet          : ${WALLET}"
echo "Devnet balance  : ${BAL_RAW}"
echo

if [[ "${BAL_INT}" -lt 10 ]]; then
  echo "⚠  Low devnet balance. SP1 verifier + 5 Anchor programs need ~15-20 SOL."
  echo "   Options:"
  echo "     - Retry: solana airdrop 2; solana airdrop 2; solana airdrop 2"
  echo "     - Web:   https://faucet.solana.com  (captcha, 1-2 SOL per request)"
  read -rp "Continue anyway? [y/N] " ans
  [[ "${ans}" =~ ^[Yy]$ ]] || exit 1
fi

# ── Build everything ─────────────────────────────────────────────────
echo
echo "─── Building Anchor programs ───"
cd "${REPO_ROOT}/solana-programs"
anchor build
ls -la target/deploy/*.so | awk '{ printf "  %-48s %s bytes\n", $NF, $5 }'

echo
echo "─── Building SP1 verifier program ───"
cd "${REPO_ROOT}/sp1-solana"
cargo build-sbf --manifest-path example/program/Cargo.toml
ls -la target/deploy/dpo2u_compliance_verifier.so | awk '{ printf "  %-48s %s bytes\n", $NF, $5 }'

# ── Deploy tracker ───────────────────────────────────────────────────
DEPLOY_LOG="${REPO_ROOT}/docs/devnet-deployments.md"
{
  echo "# Devnet deployments — auto-generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "| Program | Program ID | Action | Explorer |"
  echo "|---|---|---|---|"
} > "${DEPLOY_LOG}"

deploy_program() {
  local name="$1"
  local so_path="$2"
  local keypair_path="$3"

  if [[ ! -f "${so_path}" ]]; then
    echo "✗ missing SO: ${so_path}"
    exit 1
  fi
  if [[ ! -f "${keypair_path}" ]]; then
    echo "✗ missing keypair: ${keypair_path}"
    exit 1
  fi

  local pid
  pid=$(solana address -k "${keypair_path}")
  echo
  echo "─── ${name} @ ${pid} ───"

  # Detect if program exists at this ID
  local action="deploy"
  if solana program show "${pid}" -u devnet >/dev/null 2>&1; then
    echo "  program already exists on devnet — upgrading"
    action="upgrade"
  fi

  # `solana program deploy` handles both deploy + upgrade based on existence,
  # provided the wallet is the upgrade authority.
  solana program deploy "${so_path}" \
    --program-id "${keypair_path}" \
    --url devnet \
    --keypair ~/.config/solana/id.json

  echo "| ${name} | \`${pid}\` | ${action} | [view](https://explorer.solana.com/address/${pid}?cluster=devnet) |" >> "${DEPLOY_LOG}"
}

# 5 Anchor programs
for prog in compliance_registry agent_registry agent_wallet_factory fee_distributor payment_gateway; do
  deploy_program \
    "${prog}" \
    "${REPO_ROOT}/solana-programs/target/deploy/${prog}.so" \
    "${REPO_ROOT}/solana-programs/target/deploy/${prog}-keypair.json"
done

# SP1 verifier program (different cargo workspace)
deploy_program \
  "dpo2u_compliance_verifier" \
  "${REPO_ROOT}/sp1-solana/target/deploy/dpo2u_compliance_verifier.so" \
  "${REPO_ROOT}/sp1-solana/target/deploy/dpo2u_compliance_verifier-keypair.json"

echo
echo "─── Deploy complete ───"
echo "Log written to: ${DEPLOY_LOG}"
echo
echo "Suggested next step — smoke test:"
echo "  pnpm -C packages/client-sdk dpo2u-cli attest --cluster devnet \\"
echo "    --proof zk-circuits/proofs/proof.bin \\"
echo "    --public-values zk-circuits/proofs/public_values.bin"
