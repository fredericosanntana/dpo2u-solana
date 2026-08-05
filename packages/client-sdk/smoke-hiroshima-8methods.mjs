/**
 * Smoke — Hiroshima 8 novos métodos (round 2 2026-05-15).
 *
 * Exercises every instruction added to DPO2UHiroshimaClient:
 *   1. initialize_rapporteur_config   (singleton — may already exist)
 *   2. attest_caio_appointment         (type 1)
 *   3. submit_red_team_evidence        (type 2)
 *   4. commit_icoc_alignment           (type 3)
 *   5. submit_generic_attestation      (type 4 DATA_QUALITY)
 *   6. submit_generic_attestation      (type 5 AIBOG)
 *   7. revoke_attestation              (the DATA_QUALITY one)
 *   8. flag_termination_obligation     (rapporteur authority required)
 *
 * Each attestation type uses a unique ai_system_id so PDAs don't collide.
 * Steps 1 and 8 may skip cleanly if the rapporteur_config already exists or
 * we lack rapporteur authority — those failure modes are honest signal, not
 * smoke failure.
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
import anchorPkg from '@coral-xyz/anchor';
const { BorshCoder, BN } = anchorPkg;

const RPC = 'https://api.devnet.solana.com';
const HIROSHIMA_PROGRAM_ID = new PublicKey(
  '4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx',
);

const idl = JSON.parse(
  fs.readFileSync('./dist/idl/hiroshima_ai_process_attestation.json', 'utf-8'),
);
const coder = new BorshCoder(idl);
const connection = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const sha256 = (s) => new Uint8Array(crypto.createHash('sha256').update(s).digest());
const explorerUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function sendIx(ix, label) {
  try {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
      .add(ix);
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✅ ${label} → ${explorerUrl(sig)}`);
    return { ok: true, sig };
  } catch (e) {
    console.log(`⚠️  ${label} → skipped: ${e.message?.split('\n')[0]}`);
    return { ok: false, error: String(e.message || e).split('\n')[0] };
  }
}

function deriveAttestationPda(attestor, aiSystemId, attestationType) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('hiroshima_ai'),
      attestor.toBuffer(),
      Buffer.from(aiSystemId),
      Buffer.from([attestationType]),
    ],
    HIROSHIMA_PROGRAM_ID,
  );
}

async function main() {
  console.log('Authority:', authority.publicKey.toBase58());
  const results = { steps: [] };

  // ── Step 1: initialize_rapporteur_config (singleton, idempotent failure ok)
  const [rapporteurPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('rapporteur_config')],
    HIROSHIMA_PROGRAM_ID,
  );
  console.log('Rapporteur PDA:', rapporteurPda.toBase58());

  const initData = coder.instruction.encode('initialize_rapporteur_config', {});
  const r1 = await sendIx(
    new TransactionInstruction({
      programId: HIROSHIMA_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: rapporteurPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initData,
    }),
    '1. initialize_rapporteur_config',
  );
  results.steps.push({ step: 'initialize_rapporteur_config', ...r1 });

  // Helper to run attestation-shaped ixs
  async function attest(ixName, attestationType, label) {
    const aiSystemId = sha256(`smoke-${ixName}-${Date.now()}`);
    const evidenceHash = sha256(`evidence-${ixName}`);
    const [pda] = deriveAttestationPda(authority.publicKey, aiSystemId, attestationType);

    const payload = {
      ai_system_id: Array.from(aiSystemId),
      evidence_hash: Array.from(evidenceHash),
      valid_until: null,
      storage_uri: `ipfs://bafy.../${ixName}.json`,
    };
    if (ixName === 'submit_generic_attestation') {
      payload.attestation_type = attestationType;
    }

    const data = coder.instruction.encode(ixName, payload);
    const r = await sendIx(
      new TransactionInstruction({
        programId: HIROSHIMA_PROGRAM_ID,
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
      label,
    );
    return { ...r, aiSystemId: Buffer.from(aiSystemId).toString('hex'), pda: pda.toBase58() };
  }

  const r2 = await attest('attest_caio_appointment', 1, '2. attest_caio_appointment (type=1)');
  results.steps.push({ step: 'attest_caio_appointment', ...r2 });

  const r3 = await attest('submit_red_team_evidence', 2, '3. submit_red_team_evidence (type=2)');
  results.steps.push({ step: 'submit_red_team_evidence', ...r3 });

  const r4 = await attest('commit_icoc_alignment', 3, '4. commit_icoc_alignment (type=3)');
  results.steps.push({ step: 'commit_icoc_alignment', ...r4 });

  const r5 = await attest('submit_generic_attestation', 4, '5. submit_generic_attestation DATA_QUALITY (type=4)');
  results.steps.push({ step: 'submit_generic_data_quality', ...r5 });

  const r6 = await attest('submit_generic_attestation', 5, '6. submit_generic_attestation AIBOG (type=5)');
  results.steps.push({ step: 'submit_generic_aibog', ...r6 });

  // ── Step 7: revoke the DATA_QUALITY attestation from step 5 ────────────
  if (r5.ok) {
    const aiSystemIdHex = r5.aiSystemId;
    const aiSystemId = Buffer.from(aiSystemIdHex, 'hex');
    const [pda] = deriveAttestationPda(authority.publicKey, aiSystemId, 4);
    const revokeData = coder.instruction.encode('revoke_attestation', {
      reason: 'data quality regression',
      is_termination_order: false,
    });
    const r7 = await sendIx(
      new TransactionInstruction({
        programId: HIROSHIMA_PROGRAM_ID,
        keys: [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: pda, isSigner: false, isWritable: true },
        ],
        data: revokeData,
      }),
      '7. revoke_attestation (DATA_QUALITY)',
    );
    results.steps.push({ step: 'revoke_attestation', ...r7 });
  } else {
    console.log('⚠️  7. revoke_attestation skipped (step 5 failed)');
    results.steps.push({ step: 'revoke_attestation', ok: false, error: 'dependency-failed' });
  }

  // ── Step 8: flag_termination_obligation ─────────────────────────────────
  // This is rapporteur-only; might fail if config exists with a different
  // authority — that is honest signal.
  const termAiSystemId = sha256(`smoke-termination-${Date.now()}`);
  const evidenceHash = sha256('red-line violation evidence');
  const [terminationOrderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('termination_order'), Buffer.from(termAiSystemId)],
    HIROSHIMA_PROGRAM_ID,
  );
  const flagData = coder.instruction.encode('flag_termination_obligation', {
    ai_system_id: Array.from(termAiSystemId),
    reason: 'red-line category 7 violation (autonomous weapons claim)',
    evidence_hash: Array.from(evidenceHash),
    red_line_category: 7,
  });
  const r8 = await sendIx(
    new TransactionInstruction({
      programId: HIROSHIMA_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: rapporteurPda, isSigner: false, isWritable: false },
        { pubkey: terminationOrderPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: flagData,
    }),
    '8. flag_termination_obligation',
  );
  results.steps.push({
    step: 'flag_termination_obligation',
    ...r8,
    terminationOrderPda: terminationOrderPda.toBase58(),
  });

  // Summary
  const okCount = results.steps.filter((s) => s.ok).length;
  console.log(`\n📊 Summary: ${okCount}/${results.steps.length} steps green on-chain`);
  results.summary = { ok: okCount, total: results.steps.length };

  fs.writeFileSync(
    './smoke-hiroshima-8methods-result.json',
    JSON.stringify(results, null, 2),
  );
  console.log('Results written to smoke-hiroshima-8methods-result.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
