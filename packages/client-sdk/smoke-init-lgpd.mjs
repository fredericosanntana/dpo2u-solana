import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import {
  DPO2ULegalManifestClient,
  LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
} from './dist/index.js';

// Load worker output to derive the on-chain content_hash
const workerManifest = JSON.parse(
  fs.readFileSync('/root/dpo2u-legal-worker/out/corpus/LGPD/manifest.json', 'utf-8'),
);
const aggHashHex = workerManifest.aggregate_hash.replace(/^sha256:/, '');
const contentHash = new Uint8Array(Buffer.from(aggHashHex, 'hex'));
console.log('worker.aggregate_hash =', workerManifest.aggregate_hash);
console.log('on-chain.content_hash =', Buffer.from(contentHash).toString('hex'));

// Effective date: use first-record date (most recent law in our sample)
const firstRec = JSON.parse(
  fs.readFileSync(
    '/root/dpo2u-legal-worker/out/corpus/LGPD/BR_Planalto/records.jsonl',
    'utf-8',
  ).split('\n')[0],
);
const effectiveDate = Math.floor(new Date(firstRec.date).getTime() / 1000);
console.log('effective_date =', firstRec.date, '→', effectiveDate);

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
console.log('signer =', signer.publicKey.toBase58());

const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

const [pda] = DPO2ULegalManifestClient.derivePda('LGPD');
console.log('expected PDA =', pda.toBase58());

// Check existing
const existing = await client.fetch('LGPD');
if (existing) {
  console.log('Manifest already exists. version=', existing.manifestVersion, 'hash=', Buffer.from(existing.contentHash).toString('hex'));
  if (Buffer.from(existing.contentHash).toString('hex') === aggHashHex) {
    console.log('  → already up-to-date, no-op');
    process.exit(0);
  }
  console.log('  → updating...');
  const r = await client.updateManifest({
    jurisdiction: 'LGPD',
    contentHash,
    effectiveDate,
    sourceUri: 'dpo2u-legal-worker://LGPD/manifest.json@' + workerManifest.last_sync_at,
  });
  console.log('UPDATED tx=', r.signature);
  console.log('explorer:', r.explorerUrl);
} else {
  console.log('Initializing fresh manifest...');
  const r = await client.initManifest({
    jurisdiction: 'LGPD',
    contentHash,
    effectiveDate,
    sourceUri: 'dpo2u-legal-worker://LGPD/manifest.json@' + workerManifest.last_sync_at,
  });
  console.log('INITIALIZED tx=', r.signature);
  console.log('PDA:', r.manifestPda.toBase58());
  console.log('explorer:', r.explorerUrl);
}

const after = await client.fetch('LGPD');
console.log('--- on-chain state after ---');
console.log('jurisdiction:', after.jurisdiction);
console.log('version:', after.manifestVersion);
console.log('hash:', Buffer.from(after.contentHash).toString('hex'));
console.log('effective_date:', after.effectiveDate.toString(), '=', new Date(Number(after.effectiveDate)*1000).toISOString());
console.log('last_sync:', after.lastSync.toString(), '=', new Date(Number(after.lastSync)*1000).toISOString());
console.log('source_uri:', after.sourceUri);
console.log('authority:', after.authority.toBase58());
