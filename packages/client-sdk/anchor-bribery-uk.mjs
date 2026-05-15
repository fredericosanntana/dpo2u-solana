import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const wm = JSON.parse(fs.readFileSync('/root/dpo2u-legal-worker/out/corpus/BriberyAct-UK/manifest.json', 'utf-8'));
const aggHex = (wm.aggregate_hash ?? '').replace(/^sha256:/, '');
const contentHash = new Uint8Array(Buffer.from(aggHex, 'hex'));
console.log('worker hash:', aggHex);

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

const existing = await client.fetch('UK-BRIBERY');
if (existing) {
  console.log(`Already anchored v${existing.manifestVersion}`);
  process.exit(0);
}
const r = await client.initManifest({
  jurisdiction: 'UK-BRIBERY',
  contentHash,
  effectiveDate: Math.floor(Date.now() / 1000),
  sourceUri: `dpo2u-legal-worker://BriberyAct-UK/manifest.json@${wm.last_sync_at}`,
});
console.log('INITIALIZED tx:', r.signature);
console.log('PDA:', r.manifestPda.toBase58());
