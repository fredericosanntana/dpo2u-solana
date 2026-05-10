#!/usr/bin/env tsx
/**
 * b25-honest-halt.ts
 *
 * Reverte B2.5 honestamente: zera reserve + trip circuit breaker.
 * Vault fica em estado halt, undercollateralized — refletindo a realidade:
 * "test vault, sem backing real, NÃO usar em produção".
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
  const idl = JSON.parse(
    readFileSync('/root/dpo2u-solana/solana-programs/target/idl/art_vault.json', 'utf-8'),
  ) as Idl;
  const coder = new BorshCoder(idl);

  console.log('Honest halt — vault into test/no-production state');

  // 1. update_reserve(0)
  const resetIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: coder.instruction.encode('update_reserve', { reserve_amount: new BN('0') }),
  });
  const resetSig = await sendAndConfirmTransaction(conn, new Transaction().add(resetIx), [
    authority,
  ]);
  console.log(`   update_reserve(0): ${resetSig}`);

  // 2. trip_circuit_breaker (reason 9999 = "test data, not for production")
  const tripIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: coder.instruction.encode('trip_circuit_breaker', { reason_code: 9999 }),
  });
  const tripSig = await sendAndConfirmTransaction(conn, new Transaction().add(tripIx), [authority]);
  console.log(`   trip_circuit_breaker(9999): ${tripSig}`);

  console.log('\n✅ Vault halted, reserve=0, circuit_tripped=true.');
  console.log('   Estado honesto: vault test, undercollateralized, halt.');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
