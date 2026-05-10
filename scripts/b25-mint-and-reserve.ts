#!/usr/bin/env tsx
/**
 * b25-mint-and-reserve.ts
 *
 * Sprint B2.5 — Update reserve + mint test ARTs num vault já inicializado.
 *
 * Sequence:
 * 1. update_reserve(11_000 USDC)  // caller-asserted, cobre 10k mint + 3.5% buffer
 * 2. mint_art(10_000 USDC)        // outstanding_supply: 0 → 10_000_000_000
 *
 * Pré-requisitos: vault PDA já existe (rodar init-art-vault-devnet.ts antes).
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/b25-mint-and-reserve.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder, BN, Idl } from '@coral-xyz/anchor';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ART_VAULT_PROGRAM_ID = new PublicKey('C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna');
const DEVNET_RPC = 'https://api.devnet.solana.com';
const RESERVE_AMOUNT = 11_000_000_000n; // 11k USDC (6 decimals)
const MINT_AMOUNT = 10_000_000_000n;    // 10k USDC

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8'))));
}

function deriveArtVaultPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('art_vault'), authority.toBuffer()],
    ART_VAULT_PROGRAM_ID,
  )[0];
}

async function main() {
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const authority = loadKeypair(join(homedir(), '.config', 'solana', 'id.json'));
  const vaultPda = deriveArtVaultPda(authority.publicKey);

  console.log('Sprint B2.5 — update_reserve + mint_art');
  console.log(`Authority : ${authority.publicKey.toBase58()}`);
  console.log(`Vault PDA : ${vaultPda.toBase58()}`);

  const info = await conn.getAccountInfo(vaultPda);
  if (!info) throw new Error('Vault PDA not initialized — run init-art-vault-devnet.ts first');

  const idl = JSON.parse(
    readFileSync('/root/dpo2u-solana/solana-programs/target/idl/art_vault.json', 'utf-8'),
  ) as Idl;
  const coder = new BorshCoder(idl);

  // ─── update_reserve ──────────────────────────────────────────────────────
  const updateData = coder.instruction.encode('update_reserve', {
    reserve_amount: new BN(RESERVE_AMOUNT.toString()),
  });
  const updateIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: updateData,
  });
  console.log('\n🚀 update_reserve(11_000 USDC)...');
  const updateSig = await sendAndConfirmTransaction(conn, new Transaction().add(updateIx), [
    authority,
  ]);
  console.log(`   ✓ Tx: ${updateSig}`);

  // ─── mint_art ────────────────────────────────────────────────────────────
  const mintData = coder.instruction.encode('mint_art', {
    amount: new BN(MINT_AMOUNT.toString()),
  });
  const mintIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: mintData,
  });
  console.log('\n🚀 mint_art(10_000 USDC)...');
  const mintSig = await sendAndConfirmTransaction(conn, new Transaction().add(mintIx), [authority]);
  console.log(`   ✓ Tx: ${mintSig}`);

  console.log('\n✅ B2.5 done. State agora:');
  console.log(`   reserve_amount     = ${RESERVE_AMOUNT} (${RESERVE_AMOUNT / 1_000_000n} USDC)`);
  console.log(`   outstanding_supply = ${MINT_AMOUNT} (${MINT_AMOUNT / 1_000_000n} USDC)`);
  console.log(`   coverage ratio     = ${Number((RESERVE_AMOUNT * 10000n) / MINT_AMOUNT)} bps (${((Number(RESERVE_AMOUNT) / Number(MINT_AMOUNT)) * 100).toFixed(2)}%)`);
  console.log(`\n🔍 Re-run audit:`);
  console.log(`   curl -H "x-api-key: \$TOKEN" -d '{"vaultPda":"${vaultPda.toBase58()}","cluster":"devnet"}' \\`);
  console.log(`        https://mcp.dpo2u.com/tools/audit_micar_art`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
