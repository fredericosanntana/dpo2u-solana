/**
 * Smoke — aiverify-attestation v2 (re-deployed at new program ID
 * CmPVUPo54hV25r5iw59X1yR1f5tEsn7FNmywFMDiPT7j on 2026-05-15 after Squads
 * vault authority deadlock on old DSCVx...6cm).
 *
 * Flow:
 *   1. attest_model → ModelAttestation PDA + ModelAttested event
 *   2. verify_against_legal_manifest (GDPR) → ModelVerifiedAgainstManifest
 *
 * Confirms the new program is live AND the verify_against_legal_manifest
 * cross-program reference works (this was the feature the Squads deadlock
 * had been blocking since 2026-05-15 round 1).
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
const { BorshCoder } = anchorPkg;

const RPC = 'https://api.devnet.solana.com';
const AIVERIFY_PROGRAM_ID = new PublicKey(
  'CmPVUPo54hV25r5iw59X1yR1f5tEsn7FNmywFMDiPT7j',
);
const LEGAL_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

const idl = JSON.parse(
  fs.readFileSync('./dist/idl/aiverify_attestation.json', 'utf-8'),
);
const coder = new BorshCoder(idl);
const connection = new Connection(RPC, 'confirmed');
const operator = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const sha256 = (s) => new Uint8Array(crypto.createHash('sha256').update(s).digest());
const explorerUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const jurisdictionBytes = (code) => {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return new Uint8Array(buf);
};

async function sendIx(ix, label) {
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = operator.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const sig = await sendAndConfirmTransaction(connection, tx, [operator]);
  console.log(`✅ ${label} → ${explorerUrl(sig)}`);
  return sig;
}

async function main() {
  console.log('Operator:', operator.publicKey.toBase58());

  const modelHash = sha256(`claude-opus-4-7-${Date.now()}`);
  const testReportHash = sha256('aiverify-test-engine-report-v2.json');
  const vkRoot = sha256('aiverify-toolkit-vk-root');

  const [attestationPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('aiverify'),
      operator.publicKey.toBuffer(),
      Buffer.from(modelHash),
    ],
    AIVERIFY_PROGRAM_ID,
  );
  console.log('Attestation PDA:', attestationPda.toBase58());

  const attestData = coder.instruction.encode('attest_model', {
    model_hash: Array.from(modelHash),
    test_report_hash: Array.from(testReportHash),
    vk_root: Array.from(vkRoot),
    framework_code: 0, // AI Verify Singapore
  });
  const sig1 = await sendIx(
    new TransactionInstruction({
      programId: AIVERIFY_PROGRAM_ID,
      keys: [
        { pubkey: operator.publicKey, isSigner: true, isWritable: true },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: attestData,
    }),
    '1. attest_model',
  );

  // Step 2: verify against MGF-AGENTIC manifest (most relevant for AI Verify)
  const [manifestPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('legal_manifest'), jurisdictionBytes('MGF-AGENTIC')],
    LEGAL_MANIFEST_PROGRAM_ID,
  );
  console.log('MGF-AGENTIC manifest PDA:', manifestPda.toBase58());

  const verifyData = coder.instruction.encode('verify_against_legal_manifest', {});
  const sig2 = await sendIx(
    new TransactionInstruction({
      programId: AIVERIFY_PROGRAM_ID,
      keys: [
        { pubkey: attestationPda, isSigner: false, isWritable: false },
        { pubkey: manifestPda, isSigner: false, isWritable: false },
      ],
      data: verifyData,
    }),
    '2. verify_against_legal_manifest (MGF-AGENTIC)',
  );

  const txDetail = await connection.getParsedTransaction(sig2, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const eventLogs = (txDetail?.meta?.logMessages || []).filter((l) =>
    l.includes('ModelVerifiedAgainstManifest') || l.includes('Program data'),
  );
  console.log('\n📋 Event logs:');
  eventLogs.forEach((l) => console.log('  ', l));

  const results = {
    new_program_id: AIVERIFY_PROGRAM_ID.toBase58(),
    attestation_pda: attestationPda.toBase58(),
    mgf_agentic_manifest_pda: manifestPda.toBase58(),
    attest_sig: sig1,
    verify_sig: sig2,
    event_logs_captured: eventLogs.length,
  };
  fs.writeFileSync(
    './smoke-aiverify-v2-result.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\n✅ aiverify v2 fully operational. 11/14 → 12/14 cross-ref unlocked.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
