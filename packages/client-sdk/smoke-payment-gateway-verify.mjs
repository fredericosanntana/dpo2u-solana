/**
 * Smoke — payment-gateway verify_against_legal_manifest (deployed tx
 * 2ciS6QassFW1…EGDa 2026-05-15).
 *
 * Flow:
 *   1. Create an invoice (token=USDC-devnet placeholder mint, amount=1_000_000)
 *   2. Call verify_against_legal_manifest against the GDPR manifest
 *      (chosen for cross-border payment relevance per the ix doc-comment)
 *   3. Parse logs → InvoiceVerifiedAgainstManifest event
 *
 * Note: only verify is exercised — settle requires real ATAs which is out
 * of scope for this smoke. create_invoice is enough to derive the invoice
 * PDA that verify reads.
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
const PAYMENT_GATEWAY_PROGRAM_ID = new PublicKey(
  '4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q',
);
const LEGAL_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

const idl = JSON.parse(
  fs.readFileSync('./dist/idl/payment_gateway.json', 'utf-8'),
);
const coder = new BorshCoder(idl);
const connection = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const explorerUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const jurisdictionBytes = (code) => {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return new Uint8Array(buf);
};

async function sendIx(ix) {
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return sendAndConfirmTransaction(connection, tx, [payer]);
}

async function main() {
  console.log('Payer:', payer.publicKey.toBase58());
  const payee = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey; // placeholder; verify doesn't touch token program
  const toolName = 'dpo2u_audit_micar_art';
  const nonce = new BN(Date.now());
  const amount = new BN(1_000_000); // 1.0 USDC if 6 decimals

  const [invoicePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('invoice'),
      payer.publicKey.toBuffer(),
      Buffer.from(toolName),
      nonce.toArrayLike(Buffer, 'le', 8),
    ],
    PAYMENT_GATEWAY_PROGRAM_ID,
  );
  console.log('Invoice PDA:', invoicePda.toBase58());

  // ── Step 1: create_invoice ──────────────────────────────────────────────
  const createData = coder.instruction.encode('create_invoice', {
    tool_name: toolName,
    amount,
    mint,
    nonce,
  });
  const sig1 = await sendIx(
    new TransactionInstruction({
      programId: PAYMENT_GATEWAY_PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: payee, isSigner: false, isWritable: false },
        { pubkey: invoicePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: createData,
    }),
  );
  console.log(`✅ create_invoice → ${explorerUrl(sig1)}`);

  // ── Step 2: verify_against_legal_manifest (GDPR) ────────────────────────
  const [gdprManifestPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('legal_manifest'), jurisdictionBytes('GDPR')],
    LEGAL_MANIFEST_PROGRAM_ID,
  );
  console.log('GDPR manifest PDA:', gdprManifestPda.toBase58());

  const verifyData = coder.instruction.encode('verify_against_legal_manifest', {});
  const sig2 = await sendIx(
    new TransactionInstruction({
      programId: PAYMENT_GATEWAY_PROGRAM_ID,
      keys: [
        { pubkey: invoicePda, isSigner: false, isWritable: false },
        { pubkey: gdprManifestPda, isSigner: false, isWritable: false },
      ],
      data: verifyData,
    }),
  );
  console.log(`✅ verify_against_legal_manifest (GDPR) → ${explorerUrl(sig2)}`);

  // ── Capture event log ───────────────────────────────────────────────────
  const txDetail = await connection.getParsedTransaction(sig2, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const programLogs = (txDetail?.meta?.logMessages || []).filter((l) =>
    l.includes('InvoiceVerifiedAgainstManifest') || l.includes('Program data'),
  );
  console.log('\n📋 Event logs:');
  programLogs.forEach((l) => console.log('  ', l));

  const results = {
    invoice_pda: invoicePda.toBase58(),
    gdpr_manifest_pda: gdprManifestPda.toBase58(),
    create_invoice_sig: sig1,
    verify_sig: sig2,
    event_logs_captured: programLogs.length,
  };
  fs.writeFileSync(
    './smoke-payment-gateway-verify-result.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\n✅ smoke verde. Results written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
