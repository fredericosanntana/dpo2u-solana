#!/usr/bin/env tsx
/**
 * init-pipa-ready-devnet.ts — Sprint D fase 2 PIPA Korea ZK Identity.
 *
 * **NÃO executa por padrão**: `issue_attestation` requer SP1 v6 Groth16 proof
 * real (356 bytes) bound ao subject_commitment. Gerar uma proof é fora do
 * escopo deste script — use a mesma pipeline que `compliance-registry` e
 * `consent-manager` (sp1-prover ou DPO2U proof service).
 *
 * Este script:
 *   - Mostra como construir os args
 *   - Valida via DRY_RUN=1 (sem submeter)
 *   - Em DRY_RUN=0 + proof real, submeteria a tx
 *
 * Run dry-run (default):
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/init-pipa-ready-devnet.ts
 *
 * Run real:
 *   PIPA_PROOF_HEX=<356-byte hex> PIPA_PUBLIC_INPUTS_HEX=<96-byte hex> \
 *     DRY_RUN=0 npx tsx scripts/init-pipa-ready-devnet.ts
 */

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DPO2UPipaClient, ATTRIBUTE_KIND } from '../packages/client-sdk/src/pipa.js';

const DRY_RUN = (process.env.DRY_RUN ?? '1') === '1';

async function main() {
  const attestor = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );
  const client = new DPO2UPipaClient({ cluster: 'devnet', signer: attestor });

  // Demo subject_commitment (Poseidon ou sha256 of identity_secret + salt)
  const subjectCommitment = createHash('sha256')
    .update('demo-secret-2026-05-01' + 'demo-salt-001')
    .digest();
  const attributeMetadataHash = createHash('sha256')
    .update('age_gate_19:expires:2026-12-31:issuer:DPO2U-Demo-Attestor')
    .digest();

  console.log('Sprint D fase 2 — PIPA Korea ZK Identity (ready, DRY_RUN=' + DRY_RUN + ')');
  console.log(`  Attestor: ${attestor.publicKey.toBase58()}`);
  console.log(`  subject_commitment hex: ${Buffer.from(subjectCommitment).toString('hex')}`);
  console.log(`  attribute_kind: AGE_GATE_19`);
  console.log();

  if (DRY_RUN) {
    console.log('  📋 DRY_RUN=1 — não submetendo. Para executar:');
    console.log('     1. Gerar SP1 v6 Groth16 proof bound ao subject_commitment');
    console.log('     2. PIPA_PROOF_HEX=<...> PIPA_PUBLIC_INPUTS_HEX=<...> DRY_RUN=0');
    console.log();
    console.log('  Args que seriam passados:');
    console.log({
      subjectCommitmentHex: Buffer.from(subjectCommitment).toString('hex'),
      attributeKind: ATTRIBUTE_KIND.AGE_GATE_19,
      attributeMetadataHashHex: Buffer.from(attributeMetadataHash).toString('hex'),
      proofHex: '<356 bytes>',
      publicInputsHex: '<96 bytes; bytes [32..64] = subject_commitment>',
    });
    return;
  }

  const proofHex = process.env.PIPA_PROOF_HEX;
  const publicInputsHex = process.env.PIPA_PUBLIC_INPUTS_HEX;
  if (!proofHex || !publicInputsHex) {
    throw new Error('DRY_RUN=0 requires PIPA_PROOF_HEX and PIPA_PUBLIC_INPUTS_HEX env vars');
  }
  const res = await client.issueAttestation({
    subjectCommitment,
    attributeKind: ATTRIBUTE_KIND.AGE_GATE_19,
    attributeMetadataHash,
    proof: Buffer.from(proofHex, 'hex'),
    publicInputs: Buffer.from(publicInputsHex, 'hex'),
    storageUri: 'demo://sprint-d-fase2-2026-05-01/pipa-test-data',
  });
  console.log(`  ✅ Tx: ${res.signature}`);
  console.log(`  PDA: ${res.attestationPda.toBase58()}`);
  console.log(`  Explorer: ${res.explorerUrl}`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
