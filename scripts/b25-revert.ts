#!/usr/bin/env tsx
/**
 * b25-revert.ts
 *
 * Reverte B2.5: redeem 10k ARTs (5 × 2k) + update_reserve(0).
 * Restaura vault para estado config-only (supply=0, reserve=0).
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
const REDEEM_CHUNK = 2_000_000_000n; // 2k USDC (within liquidity budget 2.2k)
const TOTAL_TO_REDEEM = 10_000_000_000n; // 10k USDC

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

  console.log('Reverting B2.5 — restore vault to config-only state');
  console.log(`Vault PDA : ${vaultPda.toBase58()}`);

  const idl = JSON.parse(
    readFileSync('/root/dpo2u-solana/solana-programs/target/idl/art_vault.json', 'utf-8'),
  ) as Idl;
  const coder = new BorshCoder(idl);

  const chunks = Number(TOTAL_TO_REDEEM / REDEEM_CHUNK);
  for (let i = 0; i < chunks; i++) {
    const data = coder.instruction.encode('redeem_art', {
      amount: new BN(REDEEM_CHUNK.toString()),
    });
    const ix = new TransactionInstruction({
      programId: ART_VAULT_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority]);
    console.log(`   redeem ${i + 1}/${chunks}: 2k USDC — ${sig.slice(0, 20)}...`);
  }

  // Reset reserve to 0
  const resetData = coder.instruction.encode('update_reserve', {
    reserve_amount: new BN('0'),
  });
  const resetIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: resetData,
  });
  const resetSig = await sendAndConfirmTransaction(conn, new Transaction().add(resetIx), [
    authority,
  ]);
  console.log(`\n   update_reserve(0): ${resetSig}`);
  console.log('\n✅ Vault restored to config-only state. Re-run audit to confirm supply=0, reserve=0.');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
