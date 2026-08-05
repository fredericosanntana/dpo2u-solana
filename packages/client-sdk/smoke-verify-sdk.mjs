import fs from 'node:fs';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { DPO2UPopiaClient } from './dist/index.js';

const signer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const client = new DPO2UPopiaClient({ signer, cluster: 'devnet' });
const orgIdHash = crypto.createHash('sha256').update('Acme South Africa Pty Ltd / Reg 2021/123456/07').digest();
const r = await client.verifyAgainstLegalManifest({ organizationIdHash: new Uint8Array(orgIdHash) });
console.log('signature:', r.signature.slice(0, 30) + '..');
console.log('appointmentPda:', r.appointmentPda.toBase58());
console.log('legalManifestPda:', r.legalManifestPda.toBase58());
console.log('explorer:', r.explorerUrl);
