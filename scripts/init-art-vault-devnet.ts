#!/usr/bin/env tsx
/**
 * init-art-vault-devnet.ts
 *
 * Sprint B2 — Inicializa art-vault em devnet com state realista para audit MICAR.
 *
 * Pre-requisitos:
 * - solana CLI configurado em devnet
 * - Wallet ~/.config/solana/id.json com >= 1 SOL devnet
 * - art-vault program já deployed (C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna)
 * - Anchor IDL gerada (target/idl/art_vault.json)
 *
 * Run:
 *   cd /root/dpo2u-solana
 *   npx tsx scripts/init-art-vault-devnet.ts
 *
 * Output:
 *   - vault PDA criado em devnet
 *   - tx signature em stdout
 *   - explorer URL ready pra share
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder, BN, Idl } from '@coral-xyz/anchor';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Config ─────────────────────────────────────────────────────────────────

const ART_VAULT_PROGRAM_ID = new PublicKey('C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna');
const DEVNET_RPC = 'https://api.devnet.solana.com';

// MiCAR-compliant defaults (Sprint B2 spec)
const CAPITAL_BUFFER_BPS = 350;     // 3.5% (MiCAR Art. 35 mínimo é 300/3%)
const LIQUIDITY_BPS = 2000;         // 20% (MiCAR Art. 39 instant redemption)
const DAILY_CAP = 100_000_000_000n; // 100k USDC * 1e6 (assumindo 6 decimais)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

function deriveArtVaultPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('art_vault'), authority.toBuffer()],
    ART_VAULT_PROGRAM_ID,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const keypairPath = join(homedir(), '.config', 'solana', 'id.json');
  const authority = loadKeypair(keypairPath);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Sprint B2 — Init art-vault devnet');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program:   ${ART_VAULT_PROGRAM_ID.toBase58()}`);
  console.log(`RPC:       ${DEVNET_RPC}`);
  console.log();

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.5e9) {
    console.error('Saldo insuficiente. Use: solana airdrop 2 --url devnet');
    process.exit(1);
  }

  const [vaultPda, bump] = deriveArtVaultPda(authority.publicKey);
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  // Check if vault already exists
  const existing = await connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log(`⚠️  Vault PDA já existe (${existing.data.length} bytes). Skipping init.`);
    console.log(`   Para re-init: close PDA primeiro ou usar authority diferente.`);
    console.log();
    console.log(`Explorer: https://explorer.solana.com/address/${vaultPda.toBase58()}?cluster=devnet`);
    return;
  }

  // ─── Build init_vault instruction ─────────────────────────────────────────
  // IDL load (assumes Anchor IDL committed in target/idl/art_vault.json)
  const idlPath = join('/root/dpo2u-solana/solana-programs/target/idl/art_vault.json');
  let idl: Idl;
  try {
    idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
  } catch (e) {
    console.error('IDL não encontrada em', idlPath);
    console.error('Run: cd /root/dpo2u-solana/solana-programs && anchor build');
    process.exit(1);
  }

  const coder = new BorshCoder(idl);
  const initData = coder.instruction.encode('init_vault', {
    liquidity_bps: LIQUIDITY_BPS,
    capital_buffer_bps: CAPITAL_BUFFER_BPS,
    daily_cap: new BN(DAILY_CAP.toString()),
  });

  const initIx = new TransactionInstruction({
    programId: ART_VAULT_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  });

  const tx = new Transaction().add(initIx);
  console.log();
  console.log('🚀 Sending init_vault...');
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);

  console.log();
  console.log('✅ Vault initialized!');
  console.log(`   Tx:       ${sig}`);
  console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`   Explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log();
  console.log('📊 Initial config:');
  console.log(`   capital_buffer_bps: ${CAPITAL_BUFFER_BPS} (${CAPITAL_BUFFER_BPS / 100}%)`);
  console.log(`   liquidity_bps:      ${LIQUIDITY_BPS} (${LIQUIDITY_BPS / 100}%)`);
  console.log(`   daily_cap:          ${DAILY_CAP / 1_000_000n} USDC`);
  console.log();
  console.log('🔍 Next step (B3): re-run audit_micar_art com vaultPda real:');
  console.log(`   curl -H "x-api-key: $TOKEN" -d '{"vaultPda":"${vaultPda.toBase58()}","cluster":"devnet"}' \\`);
  console.log(`        https://mcp.dpo2u.com/tools/audit_micar_art`);
  console.log();
  console.log('Esperado: score 60-95/100 (depende de update_reserve subsequente).');
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
