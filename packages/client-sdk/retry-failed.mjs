/**
 * α-retry — re-attempts the 4 sync-failed jurisdictions from Bridge C run on
 * 2026-05-14. Increases the poll window from 120s to 300s so slower upstream
 * sources (IN/IndiaCode, AE/DIFC-Legislation, UK/Legislation, ID/PeraturanGO)
 * have time to complete a sample fetch.
 */

import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const WORKER_BASE = 'http://127.0.0.1:8782';
const CORPUS_HOST_DIR = '/root/dpo2u-legal-worker/out/corpus';

const TARGETS = [
  { workerCode: 'DPDP',          onChain: 'DPDP' },
  { workerCode: 'PDP-ID',        onChain: 'PDP-ID' },
  { workerCode: 'PDPL-UAE',      onChain: 'PDPL-UAE' },
  { workerCode: 'BriberyAct-UK', onChain: 'UK-BRIBERY' },
];

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

async function postSync(workerCode) {
  const res = await fetch(`${WORKER_BASE}/sync/${encodeURIComponent(workerCode)}?mode=sample`, { method: 'POST' });
  if (!res.ok) throw new Error(`sync POST failed: ${res.status}`);
  return res.json();
}

async function pollJob(jobId, maxSecs = 300) {
  const start = Date.now();
  let lastStatus = null;
  for (;;) {
    const res = await fetch(`${WORKER_BASE}/jobs/${jobId}`);
    const j = await res.json();
    if (j.status !== lastStatus) {
      console.log(`    [${Math.round((Date.now() - start) / 1000)}s] ${j.status}`);
      lastStatus = j.status;
    }
    if (j.status === 'completed' || j.status === 'failed') return j;
    if ((Date.now() - start) / 1000 > maxSecs) return { ...j, status: 'timeout' };
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function readWorkerManifest(workerCode) {
  const p = `${CORPUS_HOST_DIR}/${workerCode}/manifest.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function processOne({ workerCode, onChain }) {
  console.log(`\n→ ${workerCode} (on-chain ${onChain})`);
  const result = { workerCode, onChain };

  const queued = await postSync(workerCode);
  console.log(`    job ${queued.id.slice(0, 8)}..`);
  const finished = await pollJob(queued.id, 300);
  if (finished.status !== 'completed') {
    result.verdict = `sync-${finished.status}`;
    result.error = finished.error;
    console.log(`    verdict: ${result.verdict}`);
    return result;
  }

  const wm = readWorkerManifest(workerCode);
  const aggHash = (wm?.aggregate_hash ?? '').replace(/^sha256:/, '');
  if (!aggHash || aggHash.length !== 64) {
    result.verdict = 'invalid-hash';
    console.log(`    verdict: ${result.verdict}`);
    return result;
  }
  const contentHash = new Uint8Array(Buffer.from(aggHash, 'hex'));
  result.workerHash = `sha256:${aggHash}`;
  result.recordCount = (wm.sources ?? []).reduce((a, s) => a + (s.record_count ?? 0), 0);

  let existing = null;
  try {
    existing = await client.fetch(onChain);
  } catch {}
  if (existing) {
    const sameHash = Buffer.from(existing.contentHash).toString('hex') === aggHash;
    if (sameHash) {
      result.verdict = 'already-anchored-in-sync';
      result.manifestVersion = existing.manifestVersion;
      console.log(`    verdict: ${result.verdict} v${existing.manifestVersion}`);
      return result;
    }
    const upd = await client.updateManifest({
      jurisdiction: onChain,
      contentHash,
      effectiveDate: Math.floor(Date.now() / 1000),
      sourceUri: `dpo2u-legal-worker://${workerCode}/manifest.json@${wm.last_sync_at}`,
    });
    result.verdict = 'updated';
    result.txSig = upd.signature;
    result.pda = upd.manifestPda.toBase58();
    result.manifestVersion = existing.manifestVersion + 1;
    console.log(`    verdict: updated v${result.manifestVersion} tx ${upd.signature.slice(0, 14)}..`);
    return result;
  }

  const init = await client.initManifest({
    jurisdiction: onChain,
    contentHash,
    effectiveDate: Math.floor(Date.now() / 1000),
    sourceUri: `dpo2u-legal-worker://${workerCode}/manifest.json@${wm.last_sync_at}`,
  });
  result.verdict = 'initialized';
  result.txSig = init.signature;
  result.pda = init.manifestPda.toBase58();
  result.manifestVersion = 1;
  console.log(`    verdict: initialized v1 tx ${init.signature.slice(0, 14)}.. records=${result.recordCount}`);
  return result;
}

async function main() {
  console.log(`Signer: ${signer.publicKey.toBase58()}`);
  const results = [];
  for (const t of TARGETS) results.push(await processOne(t));
  fs.writeFileSync('./retry-failed-results.json', JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2));
  console.log('\n=== Summary ===');
  const byVerdict = {};
  for (const r of results) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log(byVerdict);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
