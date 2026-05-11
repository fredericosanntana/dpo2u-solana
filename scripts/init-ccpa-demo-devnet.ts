#!/usr/bin/env tsx
/**
 * init-ccpa-demo-devnet.ts — Sprint D fase 2 demo (CCPA opt-out registration).
 *
 * DEMO data: consumer ID e business são fictícios.
 */

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DPO2UCcpaClient, OPTOUT_KIND } from '../packages/client-sdk/src/ccpa.js';

async function main() {
  const business = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );
  const client = new DPO2UCcpaClient({ cluster: 'devnet', signer: business });

  console.log('Sprint D fase 2 — CCPA demo opt-out');
  console.log(`  Business: ${business.publicKey.toBase58()}`);

  const res = await client.registerOptout({
    consumerId: 'DPO2U-DEMO-CONSUMER-001',
    optoutKind: OPTOUT_KIND.SHARE,
    viaGpc: true,
    storageUri: 'demo://sprint-d-fase2-2026-05-01/ccpa-test-data',
  });

  console.log(`  ✅ Tx: ${res.signature}`);
  console.log(`  PDA: ${res.optoutPda.toBase58()}`);
  console.log(`  Explorer: ${res.explorerUrl}`);
  console.log();
  console.log('  ⚠️  DEMO data — opt-out kind=SHARE, via_gpc=true.');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
