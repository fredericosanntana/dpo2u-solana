import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { DPO2ULegalManifestClient } from './dist/index.js';

const TARGETS = [
  { workerCode: 'DPDP', onChain: 'DPDP' },
  { workerCode: 'PDP-ID', onChain: 'PDP-ID' },
];
const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2ULegalManifestClient({ signer, cluster: 'devnet' });

for (const { workerCode, onChain } of TARGETS) {
  const wm = JSON.parse(fs.readFileSync(`/root/dpo2u-legal-worker/out/corpus/${workerCode}/manifest.json`, 'utf-8'));
  const aggHex = (wm.aggregate_hash ?? '').replace(/^sha256:/, '');
  const contentHash = new Uint8Array(Buffer.from(aggHex, 'hex'));
  const records = (wm.sources ?? []).reduce((a, s) => a + (s.record_count ?? 0), 0);
  console.log(`\n→ ${workerCode}: hash=${aggHex.slice(0,16)}.. records=${records}`);
  const existing = await client.fetch(onChain);
  if (existing) {
    console.log(`  already anchored v${existing.manifestVersion}`);
    continue;
  }
  const r = await client.initManifest({
    jurisdiction: onChain,
    contentHash,
    effectiveDate: Math.floor(Date.now() / 1000),
    sourceUri: `dpo2u-legal-worker://${workerCode}/manifest.json@${wm.last_sync_at}`,
  });
  console.log(`  INITIALIZED tx ${r.signature.slice(0,16)}..`);
  console.log(`  PDA ${r.manifestPda.toBase58()}`);
}
