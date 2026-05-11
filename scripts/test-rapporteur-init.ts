/**
 * Smoke E2E — Sprint F devnet upgrade verification.
 * Calls `initialize_rapporteur_config` on the upgraded
 * hiroshima_ai_process_attestation program (devnet).
 *
 * Idempotent? No — initialize is `init` constraint, so second call fails.
 * Catches that error and continues to verify config can be read.
 */

import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROGRAM_ID = new PublicKey('4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx');
const DEVNET = 'https://api.devnet.solana.com';

const idl = JSON.parse(
  readFileSync(
    '/root/dpo2u-solana/solana-programs/target/idl/hiroshima_ai_process_attestation.json',
    'utf-8',
  ),
);

const adminKp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/id.json'), 'utf-8'))),
);

const connection = new Connection(DEVNET, 'confirmed');
const wallet = new anchor.Wallet(adminKp);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
anchor.setProvider(provider);

const program = new anchor.Program(idl as anchor.Idl, provider);

const [configPda, configBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('rapporteur_config')],
  PROGRAM_ID,
);

console.log('Admin:', adminKp.publicKey.toBase58());
console.log('Program:', PROGRAM_ID.toBase58());
console.log('RapporteurConfig PDA:', configPda.toBase58(), 'bump:', configBump);

async function main() {
  let exists = false;
  try {
    const account = await (program.account as any).rapporteurConfig.fetch(configPda);
    exists = true;
    console.log('\n[fetch] RapporteurConfig already exists:');
    console.log('  admin:', new PublicKey(account.admin).toBase58());
    console.log('  rapporteur_authority:', new PublicKey(account.rapporteurAuthority).toBase58());
    console.log('  version:', account.version);
    console.log('  initialized_at:', new Date(Number(account.initializedAt) * 1000).toISOString());
  } catch (_e) {
    console.log('\n[fetch] RapporteurConfig not found — initializing...');
  }

  if (!exists) {
    const sig = await program.methods
      .initializeRapporteurConfig()
      .accounts({
        admin: adminKp.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([adminKp])
      .rpc();
    console.log('[initialize] tx:', sig);

    const account = await (program.account as any).rapporteurConfig.fetch(configPda);
    console.log('\n[verified] RapporteurConfig:');
    console.log('  admin:', new PublicKey(account.admin).toBase58());
    console.log('  rapporteur_authority:', new PublicKey(account.rapporteurAuthority).toBase58());
    console.log('  version:', account.version);
  }

  console.log('\n[ok] Sprint F devnet upgrade verified — RapporteurConfig accessible.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
