/**
 * Smoke — compliance-registry-pinocchio verify_against_legal_manifest
 * (selector 0x05, deployed tx 4gBCsraBBe9v… 2026-05-15).
 *
 * Pinocchio (no IDL, no Anchor BorshCoder) so we hand-craft the ix:
 *   - instruction_data = [0x05]  (selector only, no args)
 *   - accounts = [legal_manifest (readonly), clock_sysvar (readonly)]
 *
 * Verifies against the LGPD manifest (anchored, plenty of confirmations).
 */

import fs from 'node:fs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const RPC = 'https://api.devnet.solana.com';
const PINOCCHIO_PROGRAM_ID = new PublicKey(
  'FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8',
);
const LEGAL_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

const connection = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const explorerUrl = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function jurisdictionBytes(code) {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return buf;
}

async function main() {
  console.log('Payer:', payer.publicKey.toBase58());

  const [lgpdPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('legal_manifest'), jurisdictionBytes('LGPD')],
    LEGAL_MANIFEST_PROGRAM_ID,
  );
  console.log('LGPD manifest PDA:', lgpdPda.toBase58());

  // selector 0x05, no args
  const data = Buffer.from([0x05]);
  const ix = new TransactionInstruction({
    programId: PINOCCHIO_PROGRAM_ID,
    keys: [
      { pubkey: lgpdPda, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`✅ verify (Pinocchio selector 0x05) → ${explorerUrl(sig)}`);

  const txDetail = await connection.getParsedTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const logs = (txDetail?.meta?.logMessages || []).filter((l) =>
    l.includes('CompliancePinocchioVerifiedAgainstManifest') ||
    l.includes('jurisdiction_prefix') ||
    l.includes('content_hash_prefix'),
  );
  console.log('\n📋 Captured logs:');
  logs.forEach((l) => console.log('  ', l));

  fs.writeFileSync(
    './smoke-pinocchio-verify-result.json',
    JSON.stringify({ sig, lgpd_pda: lgpdPda.toBase58(), logs }, null, 2),
  );
  console.log('\n✅ Pinocchio verify funcional. 12/14 → 14/14 cross-ref.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
