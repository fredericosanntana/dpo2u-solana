/**
 * Bridge E — anchor the 2 Sprint G AI governance frameworks on-chain.
 *
 * Unlike privacy jurisdictions (which have a worker corpus), MGF-AGENTIC +
 * AI-GOVERNANCE-STACK are JSON files in the MCP server's KB. We hash the
 * canonical JSON itself (stable sort) → 32-byte content_hash.
 *
 * On-chain codes (≤16-byte ASCII):
 *   - MGF-AGENTIC          → MGF-AGENTIC (11 chars, fits)
 *   - AI-GOVERNANCE-STACK  → AI-STACK    (8 chars, aliased; see lib/legal-manifest-onchain.ts)
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const KB_DIR = '/root/DPO2U/packages/mcp-server/src/kb/ai-governance';

const TARGETS = [
  { file: 'mgf-agentic.json',         onChain: 'MGF-AGENTIC', kbCode: 'MGF-AGENTIC' },
  { file: 'ai-governance-stack.json', onChain: 'AI-STACK',    kbCode: 'AI-GOVERNANCE-STACK' },
];

function canonicalSha256(obj) {
  // Stable JSON: sort keys recursively
  const stableStringify = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  };
  return crypto.createHash('sha256').update(stableStringify(obj)).digest();
}

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

async function processOne({ file, onChain, kbCode }) {
  const result = { file, onChain, kbCode, steps: [] };
  const json = JSON.parse(fs.readFileSync(`${KB_DIR}/${file}`, 'utf-8'));
  const contentHash = new Uint8Array(canonicalSha256(json));
  result.contentHash = `sha256:${Buffer.from(contentHash).toString('hex')}`;

  let existing;
  try {
    existing = await client.fetch(onChain);
  } catch (e) {
    existing = null;
  }
  if (existing) {
    const sameHash = Buffer.from(existing.contentHash).toString('hex') === Buffer.from(contentHash).toString('hex');
    if (sameHash) {
      result.verdict = 'already-anchored-in-sync';
      result.manifestVersion = existing.manifestVersion;
      return result;
    }
    const upd = await client.updateManifest({
      jurisdiction: onChain,
      contentHash,
      effectiveDate: Math.floor(Date.now() / 1000),
      sourceUri: `dpo2u-mcp://kb/ai-governance/${file}@${new Date().toISOString()}`,
    });
    result.verdict = 'updated';
    result.txSig = upd.signature;
    result.pda = upd.manifestPda.toBase58();
    result.manifestVersion = existing.manifestVersion + 1;
    return result;
  }

  const init = await client.initManifest({
    jurisdiction: onChain,
    contentHash,
    effectiveDate: Math.floor(Date.now() / 1000),
    sourceUri: `dpo2u-mcp://kb/ai-governance/${file}@${new Date().toISOString()}`,
  });
  result.verdict = 'initialized';
  result.txSig = init.signature;
  result.pda = init.manifestPda.toBase58();
  result.manifestVersion = 1;
  return result;
}

async function main() {
  console.log(`Signer: ${signer.publicKey.toBase58()}`);
  const results = [];
  for (const t of TARGETS) {
    console.log(`\n→ ${t.kbCode} (on-chain ${t.onChain})`);
    const r = await processOne(t);
    console.log(`  verdict: ${r.verdict}${r.txSig ? '  tx ' + r.txSig.slice(0, 16) + '..' : ''}`);
    console.log(`  hash:    ${r.contentHash.slice(0, 30)}..`);
    if (r.pda) console.log(`  PDA:     ${r.pda} v${r.manifestVersion}`);
    results.push(r);
  }
  fs.writeFileSync(
    './bridge-e-results.json',
    JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2),
  );
  console.log('\nSaved to bridge-e-results.json');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
