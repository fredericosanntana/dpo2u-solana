#!/usr/bin/env tsx
/**
 * smoke-composed-flow.ts — Composed Stack Round 5 smoke test
 *
 * Submete 1 attestation real via composed flow em devnet:
 *   - Pinocchio program selector 0x03 (submit_verified_compressed)
 *   - SP1 Groth16 verify CPI
 *   - Light Protocol invoke_cpi (raw — pode falhar por registration gate)
 *
 * Esperado falhar com erro related ao registered_program_pda — captura erro
 * exato pra docar bloqueador da Light Foundation registration.
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/smoke-composed-flow.ts
 */

import {
  Connection, Keypair, PublicKey, TransactionInstruction,
  Transaction, ComputeBudgetProgram, SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

const CONNECTION = new Connection("https://api.devnet.solana.com", "confirmed");

const COMPLIANCE_PINOCCHIO = new PublicKey("FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8");
const SP1_VERIFIER = new PublicKey("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");
const LIGHT_SYSTEM = new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");
const ACCOUNT_COMPRESSION = new PublicKey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");
const STATE_TREE = new PublicKey("smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT");
const NULLIFIER_QUEUE = new PublicKey("nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148");

function deriveAccountCompressionAuthority(invokingProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("cpi_authority")], invokingProgram)[0];
}

function deriveRegisteredProgramPda(invokingProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [invokingProgram.toBuffer()],
    ACCOUNT_COMPRESSION,
  )[0];
}

async function main() {
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8'))),
  );
  const balance = await CONNECTION.getBalance(wallet.publicKey);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}, balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Squads vault[3] Compliance Authority from squads-config.json
  const squadsConfig = JSON.parse(fs.readFileSync('/root/dpo2u-solana/scripts/squads-config.json', 'utf8'));
  const complianceAuthority = new PublicKey(squadsConfig.multisigs[3].vaultPda);
  console.log(`Compliance authority (Squads vault[3]): ${complianceAuthority.toBase58()}`);

  // Load SP1 proof + public values
  const proof = fs.readFileSync('/root/dpo2u-solana/zk-circuits/proofs/proof.bin');
  const publicInputs = fs.readFileSync('/root/dpo2u-solana/zk-circuits/proofs/public_values.bin');
  if (proof.length !== 356) throw new Error(`proof must be 356 bytes (got ${proof.length})`);
  if (publicInputs.length !== 96) throw new Error(`publicInputs must be 96 bytes (got ${publicInputs.length})`);
  const commitment = publicInputs.slice(32, 64);

  // Subject + payload
  const subject = wallet.publicKey;
  const payload = Buffer.from(JSON.stringify({ project: 'DPO2U', date: '2026-05-08', test: 'smoke-composed-flow' }));
  const payloadHash = createHash('sha256').update(payload).digest();
  const shdwUrl = Buffer.alloc(96, 0);
  Buffer.from('https://shdw-drive.genesysgo.net/demo-storage/smoke.json').copy(shdwUrl);

  // Build instruction data: selector 0x03 + Borsh args
  const proofLen = Buffer.alloc(4); proofLen.writeUInt32LE(proof.length, 0);
  const inputsLen = Buffer.alloc(4); inputsLen.writeUInt32LE(publicInputs.length, 0);
  const expiresAt = Buffer.alloc(8); expiresAt.writeBigInt64LE(9223372036854775807n, 0);

  const ixData = Buffer.concat([
    Buffer.from([0x03]),                  // selector
    subject.toBuffer(),                   // subject (32)
    Buffer.from(commitment),              // commitment (32)
    proofLen, proof,                      // proof Vec<u8>
    inputsLen, publicInputs,              // public_inputs Vec<u8>
    payloadHash,                          // payload_hash (32)
    shdwUrl,                              // shdw_url (96)
    Buffer.from([0]),                     // jurisdiction LGPD = 0
    complianceAuthority.toBuffer(),       // authority (32)
    expiresAt,                            // expires_at (8)
  ]);

  const accountCompressionAuthority = deriveAccountCompressionAuthority(COMPLIANCE_PINOCCHIO);
  const registeredProgramPda = deriveRegisteredProgramPda(COMPLIANCE_PINOCCHIO);
  console.log(`registered_program_pda: ${registeredProgramPda.toBase58()}`);
  console.log(`account_compression_authority: ${accountCompressionAuthority.toBase58()}`);

  // Probe registered_program_pda existence
  const rppInfo = await CONNECTION.getAccountInfo(registeredProgramPda);
  console.log(`registered_program_pda account: ${rppInfo ? 'EXISTS (owner=' + rppInfo.owner.toBase58() + ')' : 'NOT FOUND — Light registration prerequisite missing'}`);

  const ix = new TransactionInstruction({
    programId: COMPLIANCE_PINOCCHIO,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SP1_VERIFIER, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: LIGHT_SYSTEM, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },        // fee_payer
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },       // authority
      { pubkey: registeredProgramPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // _noop
      { pubkey: accountCompressionAuthority, isSigner: false, isWritable: false },
      { pubkey: ACCOUNT_COMPRESSION, isSigner: false, isWritable: false },
      { pubkey: COMPLIANCE_PINOCCHIO, isSigner: false, isWritable: false },  // invoking_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // sol_pool placeholder
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // decompression placeholder
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program (canonical 11111)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // cpi_context placeholder
      { pubkey: STATE_TREE, isSigner: false, isWritable: true },
      { pubkey: NULLIFIER_QUEUE, isSigner: false, isWritable: true },
    ],
    data: ixData,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ix,
  );

  console.log('\nSubmitting tx...');
  try {
    const sig = await sendAndConfirmTransaction(CONNECTION, tx, [wallet], {
      commitment: 'confirmed',
      skipPreflight: false,
    });
    console.log(`✅ Tx: ${sig}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } catch (err: any) {
    console.error(`\n❌ Tx FAILED (expected at this stage):`);
    console.error(err.message);
    if (err.logs) {
      console.error('\nProgram logs:');
      err.logs.forEach((l: string) => console.error(`  ${l}`));
    }
    if (err.signature) {
      console.error(`\nFailed tx hash (for inspection): ${err.signature}`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
