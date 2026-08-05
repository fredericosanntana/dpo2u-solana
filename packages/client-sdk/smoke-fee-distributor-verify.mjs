/**
 * Smoke — fee-distributor verify_against_legal_manifest
 * (deployed tx mNuY2fmx6JdRu9… 2026-05-15).
 *
 * Verifies the fee config (70/20/10 split for treasury/operator/reserve)
 * is anchored against MICAR Art. 86 (fee disclosure for ART/EMT issuers).
 *
 * Assumes the fee_config PDA already exists from a prior `initialize`
 * call. If not, this will fail with AccountNotFound — that signal is
 * honest (config never initialized on this devnet).
 */

import fs from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import anchorPkg from '@coral-xyz/anchor';
const { BorshCoder } = anchorPkg;

const RPC = 'https://api.devnet.solana.com';
const FEE_DISTRIBUTOR_PROGRAM_ID = new PublicKey(
  '88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x',
);
const LEGAL_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

const idl = JSON.parse(
  fs.readFileSync('./dist/idl/fee_distributor.json', 'utf-8'),
);
const coder = new BorshCoder(idl);
const connection = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const explorerUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function jurisdictionBytes(code) {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return buf;
}

async function ensureFeeConfig() {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config')],
    FEE_DISTRIBUTOR_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(configPda, 'confirmed');
  if (info) {
    console.log(`fee_config PDA already exists: ${configPda.toBase58()}`);
    return { configPda, created: false };
  }
  console.log(`fee_config PDA does not exist yet, initializing: ${configPda.toBase58()}`);
  const treasury = Keypair.generate().publicKey;
  const operator = Keypair.generate().publicKey;
  const reserve = Keypair.generate().publicKey;
  const data = coder.instruction.encode('initialize', {
    treasury,
    operator,
    reserve,
  });
  const ix = new TransactionInstruction({
    programId: FEE_DISTRIBUTOR_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`✅ initialize → ${explorerUrl(sig)}`);
  return { configPda, created: true, init_sig: sig };
}

async function main() {
  console.log('Authority:', authority.publicKey.toBase58());

  const { configPda, init_sig } = await ensureFeeConfig();

  const [micarPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('legal_manifest'), jurisdictionBytes('MICAR')],
    LEGAL_MANIFEST_PROGRAM_ID,
  );
  console.log('MICAR manifest PDA:', micarPda.toBase58());

  const verifyData = coder.instruction.encode('verify_against_legal_manifest', {});
  const ix = new TransactionInstruction({
    programId: FEE_DISTRIBUTOR_PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: micarPda, isSigner: false, isWritable: false },
    ],
    data: verifyData,
  });
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`✅ verify_against_legal_manifest (MICAR) → ${explorerUrl(sig)}`);

  const txDetail = await connection.getParsedTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const programLogs = (txDetail?.meta?.logMessages || []).filter((l) =>
    l.includes('FeeConfigVerifiedAgainstManifest') || l.includes('Program data'),
  );
  console.log('\n📋 Event logs:');
  programLogs.forEach((l) => console.log('  ', l));

  fs.writeFileSync(
    './smoke-fee-distributor-verify-result.json',
    JSON.stringify(
      { configPda: configPda.toBase58(), init_sig, verify_sig: sig, event_logs: programLogs.length },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
