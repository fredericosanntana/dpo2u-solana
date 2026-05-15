import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const workerManifest = JSON.parse(
  fs.readFileSync('/root/dpo2u-legal-worker/out/corpus/POPIA/manifest.json', 'utf-8'),
);
const aggHashHex = workerManifest.aggregate_hash.replace(/^sha256:/, '');
const contentHash = new Uint8Array(Buffer.from(aggHashHex, 'hex'));
const effectiveDate = Math.floor(Date.now() / 1000);

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });
const [pda] = DPO2ULegalManifestClient.derivePda('POPIA');

console.log('Worker aggregate_hash (honest, 0 records):', workerManifest.aggregate_hash);
console.log('On-chain content_hash:', Buffer.from(contentHash).toString('hex'));
console.log('PDA:', pda.toBase58());

const existing = await client.fetch('POPIA');
if (existing) {
  console.log('POPIA manifest already exists at v' + existing.manifestVersion);
} else {
  const r = await client.initManifest({
    jurisdiction: 'POPIA',
    contentHash,
    effectiveDate,
    sourceUri: 'dpo2u-legal-worker://POPIA/manifest.json@' + workerManifest.last_sync_at,
  });
  console.log('INITIALIZED tx=', r.signature);
  console.log('explorer:', r.explorerUrl);
}

const after = await client.fetch('POPIA');
console.log('--- on-chain POPIA ---');
console.log('jurisdiction:', after.jurisdiction);
console.log('version:', after.manifestVersion);
console.log('hash:', Buffer.from(after.contentHash).toString('hex'));
console.log('source_uri:', after.sourceUri);
