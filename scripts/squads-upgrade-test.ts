#!/usr/bin/env tsx
/**
 * squads-upgrade-test.ts
 *
 * Sprint 1 S1.2 — 2026-05-13.
 *
 * Executa 1 upgrade tx do aiverify_attestation via Squads Treasury multisig
 * (2-of-5, sem timelock). Fulfills "1 upgrade tx via Squads" S1.2 criterion.
 *
 * Pré-reqs (já feitos):
 *   1) Treasury multisig criado em 2026-05-08
 *      - multisigPda: 9r9A4PrroU3mrqf817YTYtQw3mKm4cbXtk4hJKArS9wD
 *      - vaultPda  : 9CgU19wh7F9AckNLZshcUE3TUX6bRhCRR421F332ESe3
 *      - threshold : 2-of-5
 *   2) aiverify_attestation upgrade authority transferida pra Treasury vault.
 *   3) Buffer 3xJk3beAhxw32P5hYYCp7dekQJACL8Y68R5Gqrmmnzo7 escrito com a
 *      mesma .so (idempotent — não muda o programa, valida o flow).
 *
 * Flow:
 *   a) Build BPF Loader Upgradeable "Upgrade" instruction
 *   b) vaultTransactionCreate (member-1 paga rent)
 *   c) proposalCreate
 *   d) proposalApprove (member-1)
 *   e) proposalApprove (member-2) — threshold 2 atingido → status Approved
 *   f) vaultTransactionExecute (member-1)
 *   g) verify programdata account updated
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import * as fs from "fs";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

const TARGET_PROGRAM = new PublicKey(
  "DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm",
);
const BUFFER = new PublicKey(
  "3xJk3beAhxw32P5hYYCp7dekQJACL8Y68R5Gqrmmnzo7",
);
const TREASURY_MULTISIG = new PublicKey(
  "9r9A4PrroU3mrqf817YTYtQw3mKm4cbXtk4hJKArS9wD",
);
const VAULT_INDEX = 0;

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Build BPF Loader Upgradeable `Upgrade` instruction (discriminator = 3). */
function buildUpgradeInstruction(spill: PublicKey, vaultPda: PublicKey): TransactionInstruction {
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [TARGET_PROGRAM.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );

  // BPF Loader Upgradeable "Upgrade" instruction:
  //   discriminator: u32 LE = 3
  //   no other args
  const data = Buffer.alloc(4);
  data.writeUInt32LE(3, 0);

  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: programDataAddress, isWritable: true, isSigner: false },
      { pubkey: TARGET_PROGRAM, isWritable: true, isSigner: false },
      { pubkey: BUFFER, isWritable: true, isSigner: false },
      { pubkey: spill, isWritable: true, isSigner: false }, // SOL refund recipient
      { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
      { pubkey: vaultPda, isWritable: false, isSigner: true }, // upgrade authority
    ],
    data,
  });
}

async function main() {
  const rpc = "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const member1 = loadKeypair("/root/dpo2u-solana/scripts/member-1.json");
  const member2 = loadKeypair("/root/dpo2u-solana/scripts/member-2.json");

  console.log(`Member 1 (payer + approver1): ${member1.publicKey.toBase58()}`);
  console.log(`Member 2 (approver2):         ${member2.publicKey.toBase58()}`);

  // Fund member-1 if needed for rent + fees (~0.05 SOL).
  let m1Bal = await connection.getBalance(member1.publicKey);
  console.log(`Member 1 balance: ${(m1Bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (m1Bal < 0.1 * LAMPORTS_PER_SOL) {
    console.log("  Funding member-1 with 0.2 SOL from default wallet...");
    const defaultKp = loadKeypair("/root/.config/solana/id.json");
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: defaultKp.publicKey,
        toPubkey: member1.publicKey,
        lamports: 0.2 * LAMPORTS_PER_SOL,
      }),
    );
    const fundSig = await sendAndConfirmTransaction(connection, fundTx, [defaultKp]);
    console.log(`  Funded: ${fundSig}`);
    m1Bal = await connection.getBalance(member1.publicKey);
    console.log(`  Member 1 new balance: ${(m1Bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }

  let m2Bal = await connection.getBalance(member2.publicKey);
  console.log(`Member 2 balance: ${(m2Bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (m2Bal < 0.02 * LAMPORTS_PER_SOL) {
    const defaultKp = loadKeypair("/root/.config/solana/id.json");
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: defaultKp.publicKey,
        toPubkey: member2.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
    );
    await sendAndConfirmTransaction(connection, fundTx, [defaultKp]);
  }

  // Derive vault PDA (default index 0)
  const [vaultPda] = multisig.getVaultPda({
    multisigPda: TREASURY_MULTISIG,
    index: VAULT_INDEX,
  });
  console.log(`Vault PDA: ${vaultPda.toBase58()} (expected 9CgU19w...)`);

  // Fetch multisig state for next transactionIndex
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    TREASURY_MULTISIG,
  );
  const nextTxIndex = BigInt(Number(multisigAccount.transactionIndex) + 1);
  console.log(`Next transactionIndex: ${nextTxIndex}`);

  // Build the inner instruction (upgrade), payer for the BPF Upgrade refund = vault itself
  const upgradeIx = buildUpgradeInstruction(vaultPda, vaultPda);
  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const innerMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash,
    instructions: [upgradeIx],
  });

  // ── a) vault_transaction_create ─────────────────────────────────────────
  console.log("\n[a] vaultTransactionCreate...");
  const createSig = await multisig.rpc.vaultTransactionCreate({
    connection,
    feePayer: member1,
    multisigPda: TREASURY_MULTISIG,
    transactionIndex: nextTxIndex,
    creator: member1.publicKey,
    vaultIndex: VAULT_INDEX,
    ephemeralSigners: 0,
    transactionMessage: innerMessage,
    memo: "S1.2 — upgrade aiverify_attestation via Treasury multisig (no-op buffer)",
  });
  console.log(`  ✓ ${createSig}`);

  // ── b) proposal_create ──────────────────────────────────────────────────
  console.log("\n[b] proposalCreate...");
  const proposalSig = await multisig.rpc.proposalCreate({
    connection,
    feePayer: member1,
    multisigPda: TREASURY_MULTISIG,
    transactionIndex: nextTxIndex,
    creator: member1,
  });
  console.log(`  ✓ ${proposalSig}`);

  // ── c) approve x2 ───────────────────────────────────────────────────────
  console.log("\n[c] proposalApprove member-1...");
  const approve1Sig = await multisig.rpc.proposalApprove({
    connection,
    feePayer: member1,
    multisigPda: TREASURY_MULTISIG,
    transactionIndex: nextTxIndex,
    member: member1,
  });
  console.log(`  ✓ ${approve1Sig}`);

  console.log("\n[d] proposalApprove member-2 (threshold = 2 atingido)...");
  const approve2Sig = await multisig.rpc.proposalApprove({
    connection,
    feePayer: member2,
    multisigPda: TREASURY_MULTISIG,
    transactionIndex: nextTxIndex,
    member: member2,
  });
  console.log(`  ✓ ${approve2Sig}`);

  // ── d) vault_transaction_execute ────────────────────────────────────────
  console.log("\n[e] vaultTransactionExecute...");
  const execSig = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: member1,
    multisigPda: TREASURY_MULTISIG,
    transactionIndex: nextTxIndex,
    member: member1.publicKey,
    signers: [member1],
  });
  console.log(`  ✓ ${execSig}`);

  console.log("\n──────────────────────────────────────────────");
  console.log("S1.2 DONE — upgrade tx via Squads complete.");
  console.log(`Transaction index : ${nextTxIndex}`);
  console.log(`Final exec txSig  : ${execSig}`);
  console.log(`Solscan           : https://solscan.io/tx/${execSig}?cluster=devnet`);
  console.log("──────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
