#!/usr/bin/env bash
# demo-4-fronts.sh — run the 4 regulatory frentes end-to-end for the Colosseum pitch.
#
# The frentes map to the Manus AI research ingested on 2026-04-22:
#   1. Cross-jurisdiction MCP (compare_jurisdictions across 6 regulators)
#   2. India DPDP on-chain Consent Manager (dpo2u-cli consent record)
#   3. MiCAR ART vault audit (audit_micar_art MCP tool)
#   4. AI Verify plugin scaffold + Solana anchoring template
#
# Frentes 2-4 run against in-memory fixtures when devnet deploys are missing,
# so this script is safe to run before the new programs are upgraded on-chain.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_SERVER_DIR="${MCP_SERVER_DIR:-/root/DPO2U/packages/mcp-server}"
SDK_DIR="$REPO_ROOT/packages/client-sdk"
CLUSTER="${CLUSTER:-devnet}"
KEYPAIR="${KEYPAIR:-$HOME/.config/solana/id.json}"

step() {
  echo
  echo "╔══════════════════════════════════════════════════════════════"
  echo "║ $1"
  echo "╚══════════════════════════════════════════════════════════════"
}

[ -d "$SDK_DIR" ] || { echo "✗ SDK dir not found: $SDK_DIR" >&2; exit 1; }
[ -d "$MCP_SERVER_DIR" ] || { echo "✗ MCP server dir not found: $MCP_SERVER_DIR" >&2; exit 1; }

# ─── Frente 4 — Cross-jurisdiction MCP ──────────────────────────────────
step "Frente 4 — compare_jurisdictions (6 regulators)"
(cd "$MCP_SERVER_DIR" && npx tsx "$REPO_ROOT/scripts/demo/frente-4-compare.mts")

# ─── Frente 1 — DPDP Consent Manager ────────────────────────────────────
step "Frente 1 — dpo2u-cli consent record (DPDP India)"
if [ -f "$KEYPAIR" ]; then
  USER_TMP=$(mktemp /tmp/demo_user.XXXXXX.json)
  solana-keygen new --no-bip39-passphrase --silent --outfile "$USER_TMP" --force > /dev/null
  USER_KEY=$(solana-keygen pubkey "$USER_TMP")
  echo "demo user pubkey: $USER_KEY"
  (cd "$SDK_DIR" && pnpm exec tsx src/bin/dpo2u-cli.ts consent record \
      --cluster "$CLUSTER" \
      --keypair "$KEYPAIR" \
      --user "$USER_KEY" \
      --purpose-code 1 \
      --purpose-text "marketing_communications" \
      --storage-uri "ipfs://QmDemo4Fronts" \
      || echo "⚠ consent record reverted (likely consent-manager not yet deployed on $CLUSTER — scaffold + IDL are ready)")
  rm -f "$USER_TMP"
else
  echo "⚠ keypair $KEYPAIR missing — skipping live tx"
  echo "  PDA derivation (offline verification):"
  (cd "$SDK_DIR" && npx tsx -e '
import { DPO2UConsentClient, CONSENT_MANAGER_PROGRAM_ID } from "./src/consent.js";
import { Keypair, PublicKey } from "@solana/web3.js";
const user = Keypair.generate().publicKey;
const fid = Keypair.generate().publicKey;
const h = DPO2UConsentClient.purposeHashFromText("marketing_communications");
const client = new DPO2UConsentClient({ signer: Keypair.generate() });
const [pda] = client.deriveConsentPda(user, fid, h);
console.log("  program : " + CONSENT_MANAGER_PROGRAM_ID.toBase58());
console.log("  PDA     : " + pda.toBase58());
' || echo "  (inline PDA demo failed — run pnpm install)")
fi

# ─── Frente 2 — MiCAR ART audit ─────────────────────────────────────────
step "Frente 2 — audit_micar_art (in-memory fixture)"
(cd "$MCP_SERVER_DIR" && npx tsx "$REPO_ROOT/scripts/demo/frente-2-audit.mts")

# ─── Frente 3 — AI Verify plugin scaffold ───────────────────────────────
step "Frente 3 — generate_aiverify_plugin_template (Singapore)"
(cd "$MCP_SERVER_DIR" && npx tsx "$REPO_ROOT/scripts/demo/frente-3-aiverify.mts")

echo
echo "✓ demo-4-fronts.sh completed"
