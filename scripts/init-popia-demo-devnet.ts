#!/usr/bin/env tsx
/**
 * init-popia-demo-devnet.ts
 *
 * Sprint D fase 2 — DEMO data: registra um POPIA Information Officer fictício
 * em devnet pra validar o fluxo end-to-end.
 *
 * **DEMO ONLY**: organização "DPO2U-Demo-Org-2026" e contact_hash são fictícios.
 * NÃO é uma nomeação POPIA real. Storage URI marca explicitamente como test data.
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/init-popia-demo-devnet.ts
 */

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DPO2UPopiaClient } from '../packages/client-sdk/src/popia.js';

async function main() {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );
  // Demo: IO is a fresh keypair (in real use, this is the formally appointed officer's pubkey)
  const informationOfficer = Keypair.generate().publicKey;

  const client = new DPO2UPopiaClient({ cluster: 'devnet', signer: authority });

  console.log('Sprint D fase 2 — POPIA demo registration');
  console.log(`  Responsible Party: ${authority.publicKey.toBase58()}`);
  console.log(`  Information Officer: ${informationOfficer.toBase58()}`);

  const orgIdHash = DPO2UPopiaClient.organizationIdHash('DPO2U-Demo-Org-2026');
  const contactHash = createHash('sha256').update('demo+io@dpo2u.com').digest();

  const res = await client.registerAppointment({
    informationOfficer,
    organizationIdHash: orgIdHash,
    contactHash,
    storageUri: 'demo://sprint-d-fase2-2026-05-01/popia-test-data',
  });

  console.log(`  ✅ Tx: ${res.signature}`);
  console.log(`  PDA: ${res.appointmentPda.toBase58()}`);
  console.log(`  Explorer: ${res.explorerUrl}`);
  console.log();
  console.log('  ⚠️  DEMO data — not a real POPIA appointment.');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
