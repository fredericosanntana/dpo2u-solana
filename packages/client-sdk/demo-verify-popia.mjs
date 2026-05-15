/**
 * Demo — register POPIA appointment + verify_against_legal_manifest live.
 *
 * Flow:
 *   1. Generate ephemeral IO (Information Officer) keypair
 *   2. Compute orgIdHash + contactHash
 *   3. Register POPIA appointment (responsible_party + IO co-sign)
 *   4. Call verify_against_legal_manifest with:
 *        - appointment PDA (just created)
 *        - POPIA legal_source_manifest PDA (already on-chain 554hEMFgY13p...)
 *   5. Parse tx logs → AppointmentVerifiedAgainstManifest event
 *
 * Cross-program reference via seeds::program proves Anchor validates that
 * the legal_manifest PDA is owned by the legal_source_manifest program.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

const RPC = 'https://api.devnet.solana.com';
const POPIA_PROGRAM_ID = new PublicKey('ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb');
const LEGAL_MANIFEST_PROGRAM_ID = new PublicKey('eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK');

const popiaIdl = JSON.parse(
  fs.readFileSync('./dist/idl/popia_info_officer_registry.json', 'utf-8'),
);
const popiaCoder = new BorshCoder(popiaIdl);

const connection = new Connection(RPC, 'confirmed');
const responsibleParty = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);
const informationOfficer = Keypair.generate();

function sha256(s) { return crypto.createHash('sha256').update(s).digest(); }

function jurisdictionBytes(code) {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return new Uint8Array(buf);
}

function deriveLegalManifestPda(code) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('legal_manifest'), jurisdictionBytes(code)],
    LEGAL_MANIFEST_PROGRAM_ID,
  );
}

async function main() {
  console.log('Responsible party:', responsibleParty.publicKey.toBase58());
  console.log('Information officer (ephemeral):', informationOfficer.publicKey.toBase58());

  const orgIdHash = sha256('Acme South Africa Pty Ltd / Reg 2021/123456/07');
  const contactHash = sha256('io@acme-sa.example | +27 11 555 1234');

  const [appointmentPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('popia_io'),
      responsibleParty.publicKey.toBuffer(),
      Buffer.from(orgIdHash),
    ],
    POPIA_PROGRAM_ID,
  );
  console.log('Appointment PDA:', appointmentPda.toBase58());

  const [legalManifestPda] = deriveLegalManifestPda('POPIA');
  console.log('Legal-manifest POPIA PDA:', legalManifestPda.toBase58());

  // ── Step 1 — register_appointment (both signers) ──────────────────────────
  const registerData = popiaCoder.instruction.encode('register_appointment', {
    organization_id_hash: Array.from(orgIdHash),
    contact_hash: Array.from(contactHash),
    storage_uri: 'ipfs://demo-popia-appointment-2026-05-15',
  });
  const registerIx = new TransactionInstruction({
    programId: POPIA_PROGRAM_ID,
    keys: [
      { pubkey: responsibleParty.publicKey, isSigner: true, isWritable: true },
      { pubkey: informationOfficer.publicKey, isSigner: true, isWritable: false },
      { pubkey: appointmentPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: registerData,
  });

  const existing = await connection.getAccountInfo(appointmentPda);
  let regSig = null;
  if (existing) {
    console.log('\nAppointment already exists — skipping register, proceeding to verify');
  } else {
    const regTx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
      .add(registerIx);
    regSig = await sendAndConfirmTransaction(connection, regTx, [
      responsibleParty,
      informationOfficer,
    ]);
    console.log('\n[1] register_appointment tx:', regSig);
    console.log('    explorer: https://explorer.solana.com/tx/' + regSig + '?cluster=devnet');
  }

  // ── Step 2 — verify_against_legal_manifest ────────────────────────────────
  const verifyData = popiaCoder.instruction.encode('verify_against_legal_manifest', {});
  const verifyIx = new TransactionInstruction({
    programId: POPIA_PROGRAM_ID,
    keys: [
      { pubkey: appointmentPda, isSigner: false, isWritable: false },
      { pubkey: legalManifestPda, isSigner: false, isWritable: false },
    ],
    data: verifyData,
  });
  const verifyTx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(connection, verifyTx, [responsibleParty]);
  console.log('\n[2] verify_against_legal_manifest tx:', verifySig);
  console.log('    explorer: https://explorer.solana.com/tx/' + verifySig + '?cluster=devnet');

  // ── Step 3 — parse tx logs for the event ──────────────────────────────────
  await new Promise((r) => setTimeout(r, 3000));
  const txInfo = await connection.getTransaction(verifySig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (txInfo?.meta?.logMessages) {
    console.log('\n[3] Program logs (excerpt):');
    for (const log of txInfo.meta.logMessages) {
      if (
        log.includes('AppointmentVerifiedAgainstManifest') ||
        log.includes('Program data') ||
        log.includes('invoke') ||
        log.includes('success')
      ) {
        console.log('    ' + log);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({
    responsibleParty: responsibleParty.publicKey.toBase58(),
    informationOfficer: informationOfficer.publicKey.toBase58(),
    appointmentPda: appointmentPda.toBase58(),
    legalManifestPda: legalManifestPda.toBase58(),
    registerTx: regSig,
    verifyTx: verifySig,
  }, null, 2));

  fs.writeFileSync(
    './demo-verify-popia-result.json',
    JSON.stringify({
      runAt: new Date().toISOString(),
      responsibleParty: responsibleParty.publicKey.toBase58(),
      informationOfficer: informationOfficer.publicKey.toBase58(),
      appointmentPda: appointmentPda.toBase58(),
      legalManifestPda: legalManifestPda.toBase58(),
      registerTx: regSig,
      verifyTx: verifySig,
    }, null, 2),
  );
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
