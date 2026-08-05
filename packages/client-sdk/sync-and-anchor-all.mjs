/**
 * Bridge C — sync 14 remaining DPO2U jurisdictions through the legal-worker
 * and anchor each result on-chain via legal_source_manifest.
 *
 * Workflow per jurisdiction:
 *   1. POST http://127.0.0.1:8782/sync/{worker_code}?mode=sample
 *   2. Poll /jobs/{id} until completed | failed | timeout
 *   3. Read /data/corpus/{worker_code}/manifest.json (via host mount path)
 *   4. Hex-decode aggregate_hash → 32-byte content_hash
 *   5. Use SDK initManifest() with the ≤16-byte on-chain code
 *   6. Skip on-chain step if already anchored
 *
 * Output:
 *   - JSON summary printed to stdout
 *   - /root/dpo2u-solana/packages/client-sdk/bridge-c-results.json with
 *     all (jurisdiction, txSig, pda, verdict) entries — used to backfill
 *     kb/jurisdictions/*.json corpusReference fields.
 */

import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const WORKER_BASE = process.env.DPO2U_WORKER_BASE ?? 'http://127.0.0.1:8782';
const CORPUS_HOST_DIR = '/root/dpo2u-legal-worker/out/corpus';

// 14 remaining DPO2U jurisdictions (LGPD + POPIA already anchored 2026-05-14)
const TARGETS = [
  { workerCode: 'GDPR',              onChain: 'GDPR' },
  { workerCode: 'MICAR',             onChain: 'MICAR' },
  { workerCode: 'DPDP',              onChain: 'DPDP' },
  { workerCode: 'APPI',              onChain: 'APPI' },
  { workerCode: 'PIPA',              onChain: 'PIPA' },
  { workerCode: 'PDP-ID',            onChain: 'PDP-ID' },
  { workerCode: 'Malaysia-PDPA',     onChain: 'Malaysia-PDPA' },
  { workerCode: 'Vietnam-Decree-13', onChain: 'VN-DECREE-13' },
  { workerCode: 'PDPA-SG',           onChain: 'PDPA-SG' },
  { workerCode: 'PIPEDA',            onChain: 'PIPEDA' },
  { workerCode: 'CCPA',              onChain: 'CCPA' },
  { workerCode: 'LFPDPPP',           onChain: 'LFPDPPP' },
  { workerCode: 'PDPL-UAE',          onChain: 'PDPL-UAE' },
  { workerCode: 'BriberyAct-UK',     onChain: 'UK-BRIBERY' },
];

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

async function postSync(workerCode) {
  const res = await fetch(`${WORKER_BASE}/sync/${encodeURIComponent(workerCode)}?mode=sample`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`sync POST failed: ${res.status}`);
  return res.json();
}

async function pollJob(jobId, maxSecs = 120) {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${WORKER_BASE}/jobs/${jobId}`);
    const j = await res.json();
    if (j.status === 'completed' || j.status === 'failed') return j;
    if ((Date.now() - start) / 1000 > maxSecs) {
      return { ...j, status: 'timeout' };
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

function readWorkerManifest(workerCode) {
  const p = `${CORPUS_HOST_DIR}/${workerCode}/manifest.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function processOne({ workerCode, onChain }) {
  const result = { workerCode, onChain, steps: [] };
  try {
    // Step 1: trigger sync
    const queued = await postSync(workerCode);
    result.steps.push({ step: 'sync-queued', jobId: queued.id });
    const finished = await pollJob(queued.id);
    result.steps.push({ step: 'sync-' + finished.status });
    if (finished.status !== 'completed') {
      result.verdict = 'sync-failed';
      result.error = finished.error ?? `worker status: ${finished.status}`;
      return result;
    }

    // Step 2: read manifest
    const wm = readWorkerManifest(workerCode);
    if (!wm) {
      result.verdict = 'no-manifest';
      return result;
    }
    const aggHash = (wm.aggregate_hash ?? '').replace(/^sha256:/, '');
    if (!aggHash || aggHash.length !== 64) {
      result.verdict = 'invalid-hash';
      result.aggregateHash = wm.aggregate_hash;
      return result;
    }
    const contentHash = new Uint8Array(Buffer.from(aggHash, 'hex'));
    result.workerHash = `sha256:${aggHash}`;
    result.recordCount = (wm.sources ?? []).reduce(
      (a, s) => a + (s.record_count ?? 0),
      0,
    );

    // Step 3: check on-chain existing
    let existing;
    try {
      existing = await client.fetch(onChain);
    } catch (e) {
      result.steps.push({ step: 'fetch-error', error: String(e.message) });
      existing = null;
    }
    if (existing) {
      const sameHash = Buffer.from(existing.contentHash).toString('hex') === aggHash;
      if (sameHash) {
        result.verdict = 'already-anchored-in-sync';
        result.pda = existing.contentHash;
        result.manifestVersion = existing.manifestVersion;
        return result;
      }
      // drift — call updateManifest
      const upd = await client.updateManifest({
        jurisdiction: onChain,
        contentHash,
        effectiveDate: Math.floor(Date.now() / 1000),
        sourceUri: `dpo2u-legal-worker://${workerCode}/manifest.json@${wm.last_sync_at}`,
      });
      result.steps.push({ step: 'updated', signature: upd.signature });
      result.verdict = 'updated';
      result.txSig = upd.signature;
      result.pda = upd.manifestPda.toBase58();
      result.manifestVersion = existing.manifestVersion + 1;
      return result;
    }

    // Step 4: init fresh manifest
    const init = await client.initManifest({
      jurisdiction: onChain,
      contentHash,
      effectiveDate: Math.floor(Date.now() / 1000),
      sourceUri: `dpo2u-legal-worker://${workerCode}/manifest.json@${wm.last_sync_at}`,
    });
    result.steps.push({ step: 'initialized', signature: init.signature });
    result.verdict = 'initialized';
    result.txSig = init.signature;
    result.pda = init.manifestPda.toBase58();
    result.manifestVersion = 1;
    return result;
  } catch (err) {
    result.verdict = 'error';
    result.error = err.message ?? String(err);
    return result;
  }
}

async function main() {
  console.log(`Signer: ${signer.publicKey.toBase58()}`);
  console.log(`Targets: ${TARGETS.length}`);
  const results = [];
  for (const t of TARGETS) {
    console.log(`\n→ ${t.workerCode} (on-chain ${t.onChain})`);
    const r = await processOne(t);
    console.log(`  verdict: ${r.verdict}${r.txSig ? '  tx ' + r.txSig.slice(0, 16) + '..' : ''}`);
    if (r.error) console.log(`  error: ${r.error}`);
    if (r.workerHash) console.log(`  hash: ${r.workerHash.slice(0, 30)}.. records=${r.recordCount}`);
    results.push(r);
  }
  fs.writeFileSync(
    './bridge-c-results.json',
    JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2),
  );
  console.log('\n=== Summary ===');
  const byVerdict = {};
  for (const r of results) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log(byVerdict);
  console.log('Results saved to bridge-c-results.json');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
