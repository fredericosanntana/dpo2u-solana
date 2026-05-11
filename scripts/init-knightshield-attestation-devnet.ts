#!/usr/bin/env tsx
/**
 * init-knightshield-attestation-devnet.ts
 *
 * Submits a REAL on-chain compliance attestation to Solana devnet, attesting that
 * KnightShield (Mobile Privacy Wallet — github.com/Knight-Shield-Wallet/wallet-solana)
 * meets DPO2U's LGPD review baseline as of 2026-Q2.
 *
 * Calls compliance_registry::create_attestation (the simple, non-ZK path).
 * For SP1-verified attestations use packages/client-sdk DPO2UClient.attestWithProof.
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/init-knightshield-attestation-devnet.ts
 */

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
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Constants ---
const COMPLIANCE_REGISTRY = new PublicKey('7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK');
const RPC_URL = 'https://api.devnet.solana.com';
const IDL_PATH = '/root/dpo2u-solana/solana-programs/target/idl/compliance_registry.json';

// KnightShield demo subject — deterministic keypair generated once and reused.
// This represents the on-chain identity of KnightShield for compliance bookkeeping.
// (Real KnightShield wallet keypair would be supplied by their team — for the demo we
// pin a fixed pubkey so each run attests against the same subject.)
const KS_SUBJECT_KEYPAIR_PATH = join(__dirname, 'knightshield-demo-subject.json');

function loadOrCreateSubject(): Keypair {
  if (existsSync(KS_SUBJECT_KEYPAIR_PATH)) {
    const bytes = JSON.parse(readFileSync(KS_SUBJECT_KEYPAIR_PATH, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  const kp = Keypair.generate();
  writeFileSync(KS_SUBJECT_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main() {
  // Issuer = the wallet that signs and pays — here, DPO2U's auditor wallet.
  const issuer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );

  const subject = loadOrCreateSubject();
  // Commitment suffix lets each demo run produce a fresh PDA. Default = Q2.
  // Override with: COMMITMENT_TAG="2026-Q3" or COMMITMENT_TAG="$(date +%Y%m%d-%H%M%S)"
  const tag = process.env.COMMITMENT_TAG ?? '2026-Q2';
  const commitmentText = `KnightShield-CLOAK-${tag}-LGPD`;
  const commitment = createHash('sha256').update(commitmentText).digest();
  const storageUri = 'github.com/Knight-Shield-Wallet/wallet-solana';
  const schemaId = COMPLIANCE_REGISTRY; // self-referential schema (LGPD baseline) — placeholder for demo

  // Derive attestation PDA: seeds = ['attestation', subject_pubkey, commitment_32bytes]
  const [attestationPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), subject.publicKey.toBuffer(), commitment],
    COMPLIANCE_REGISTRY,
  );

  console.log('━━━ DPO2U → KnightShield · LGPD compliance attestation ━━━');
  console.log(`  Issuer  : ${issuer.publicKey.toBase58()}`);
  console.log(`  Subject : ${subject.publicKey.toBase58()}  (KnightShield)`);
  console.log(`  Commit  : ${commitment.toString('hex').slice(0, 32)}...`);
  console.log(`  PDA     : ${attestationPda.toBase58()}`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // If PDA already exists from a prior run, just print and exit (idempotent demo).
  const existing = await connection.getAccountInfo(attestationPda);
  if (existing) {
    console.log(`  Status  : already on-chain (${existing.data.length} bytes, owner=${existing.owner.toBase58().slice(0, 8)}...)`);
    console.log(`  Solscan : https://explorer.solana.com/address/${attestationPda.toBase58()}?cluster=devnet`);
    return;
  }

  // Build create_attestation instruction via BorshCoder
  const idl = JSON.parse(readFileSync(IDL_PATH, 'utf-8'));
  const coder = new BorshCoder(idl);

  const data = coder.instruction.encode('create_attestation', {
    commitment: Array.from(commitment),
    storage_uri: storageUri,
    schema_id: schemaId,
    expires_at: null,
  });

  const ix = new TransactionInstruction({
    programId: COMPLIANCE_REGISTRY,
    keys: [
      { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
      { pubkey: subject.publicKey, isSigner: false, isWritable: false },
      { pubkey: attestationPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ix,
  );

  console.log('  Submitting to devnet...');
  const sig = await sendAndConfirmTransaction(connection, tx, [issuer], { commitment: 'confirmed' });

  // Fetch the just-created account to confirm size + report compute units used.
  const created = await connection.getAccountInfo(attestationPda);
  const txDetail = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });

  console.log(`  ✓ Tx     : ${sig}`);
  console.log(`  ✓ PDA    : ${attestationPda.toBase58()}  (${created?.data.length ?? '?'} bytes)`);
  if (txDetail?.meta?.computeUnitsConsumed != null) {
    const cu = txDetail.meta.computeUnitsConsumed;
    const fee = txDetail.meta.fee;
    console.log(`  ✓ CU     : ${cu.toLocaleString()}  ·  Fee: ${(fee / 1e9).toFixed(6)} SOL`);
  }
  console.log(`  Solscan : https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
});
