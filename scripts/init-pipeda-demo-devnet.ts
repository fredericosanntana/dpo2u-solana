#!/usr/bin/env tsx
/**
 * init-pipeda-demo-devnet.ts — Sprint D fase 2 demo (PIPEDA consent).
 *
 * DEMO data: organization, subject, purpose são fictícios.
 */

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DPO2UPipedaClient, CONSENT_FORM } from '../packages/client-sdk/src/pipeda.js';

async function main() {
  const organization = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );
  const subject = Keypair.generate().publicKey;
  const client = new DPO2UPipedaClient({ cluster: 'devnet', signer: organization });

  console.log('Sprint D fase 2 — PIPEDA demo consent');
  console.log(`  Organization: ${organization.publicKey.toBase58()}`);
  console.log(`  Subject: ${subject.toBase58()}`);

  // Bitmap 0xFE = bits 1-7 (Princípios 2-8) — common active duties
  // (P2 Identifying Purposes, P3 Consent, P4 Limiting Collection, P5 Limiting Use,
  //  P6 Accuracy, P7 Safeguards, P8 Openness)
  const principlesEvidenced = 0xfe;

  const res = await client.recordPipedaConsent({
    subject,
    purposeCode: 1001,
    purposeText: 'pipeda:demo:marketing-comms',
    consentForm: CONSENT_FORM.EXPRESS,
    principlesEvidenced,
    crossBorderDestination: 'US', // demo: data flows to US (Principle 4.1.3 accountability)
    storageUri: 'demo://sprint-d-fase2-2026-05-01/pipeda-test-data',
  });

  console.log(`  ✅ Tx: ${res.signature}`);
  console.log(`  PDA: ${res.consentPda.toBase58()}`);
  console.log(`  Explorer: ${res.explorerUrl}`);
  console.log();
  console.log(`  ⚠️  DEMO — express consent, principles bitmap 0x${principlesEvidenced.toString(16)} (P2-P8), cross-border US.`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
