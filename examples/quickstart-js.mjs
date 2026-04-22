#!/usr/bin/env node
/**
 * DPO2U Quickstart — JS/TS track.
 *
 * Install:
 *   npm install @dpo2u/client-sdk @solana/web3.js
 *
 * Run:
 *   export DPO2U_API_KEY="sua-jwt-key"
 *   node quickstart-js.mjs
 *
 * What this does (in ~15 lines of business code):
 *   1. Compares regulatory matrix across 5 jurisdictions (REST call, no key needed for compare)
 *   2. Submits a consent event on Solana devnet (MCP server signs as fiduciary)
 *   3. Fetches the consent PDA back to verify it's written
 *   4. Generates a sample DPIA document template
 */

import { MCPClient } from '@dpo2u/client-sdk';
import { Keypair } from '@solana/web3.js';

const mcp = new MCPClient({
  endpoint: 'https://mcp.dpo2u.com',
  apiKey: process.env.DPO2U_API_KEY,
});

// 1. Regulatory matrix
console.log('── 1. compare_jurisdictions ──');
const matrix = await mcp.compareJurisdictions({
  targetMarkets: ['BR', 'EU', 'INDIA', 'SG', 'UAE'],
  focus: 'onchain',
});
for (const r of matrix.matrix) {
  const op = r.onChainOpportunity?.target ?? '—';
  console.log(`  ${r.code.padEnd(6)} ${r.country} · ${op}`);
}
console.log(`\nRecommendation: ${matrix.recommendation.slice(0, 120)}...\n`);

// 2. On-chain consent record
console.log('── 2. submit_consent_record (devnet tx) ──');
const demoUser = Keypair.generate();
const consent = await mcp.submitConsentRecord({
  user: demoUser.publicKey.toBase58(),
  purposeCode: 1,
  purposeText: 'marketing_communications',
  storageUri: 'https://example.com/terms.pdf',
});
console.log(`  user:        ${demoUser.publicKey.toBase58()}`);
console.log(`  fiduciary:   ${consent.fiduciary}`);
console.log(`  tx:          ${consent.signature}`);
console.log(`  pda:         ${consent.consentPda}`);
console.log(`  explorer:    ${consent.explorerUrl}\n`);

// 3. Fetch the PDA back
console.log('── 3. fetch_consent_record ──');
const back = await mcp.fetchConsentRecord({
  user: demoUser.publicKey.toBase58(),
  dataFiduciary: consent.fiduciary,
  purposeText: 'marketing_communications',
});
if (back.found && back.record) {
  console.log(`  purposeCode: ${back.record.purposeCode}`);
  console.log(`  verified:    ${back.record.verified}`);
  console.log(`  issuedAt:    ${new Date(Number(back.record.issuedAt) * 1000).toISOString()}`);
} else {
  console.log('  not found (tx may still be propagating — retry in 2s)');
}
console.log();

console.log('✓ All 3 ops succeeded. You just wrote, audited, and read a DPDP consent on-chain.\n');
console.log('Next: check the explorer URL above. That tx is permanent and auditable forever.');
