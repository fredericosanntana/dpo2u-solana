/**
 * Smoke test devnet — registers a cultivator agent + submits MOTHER_REGISTERED
 * event for a fresh batch. Proves selector 0x06 is live on devnet.
 *
 * Run from /root/dpo2u-solana/solana-programs:
 *   node smoke-cannabis-event-devnet.mjs
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const RPC = 'https://api.devnet.solana.com';
const KEYPAIR_PATH = `${process.env.HOME}/.config/solana/id.json`;

const PROGRAM_PINOCCHIO = new PublicKey('FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8');
const PROGRAM_AGENT_REGISTRY = new PublicKey('5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7');

const conn = new Connection(RPC, 'confirmed');
const authority = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'))),
);

const AGENT_NAME = `cultivator:smoke-${Date.now().toString(36)}`;

function deriveAgentPda(auth, name) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), auth.toBuffer(), Buffer.from(name, 'utf8')],
    PROGRAM_AGENT_REGISTRY,
  );
}
function deriveCannabisEventPda(batchId, eventType) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('cannabis_event'), Buffer.from(batchId), Buffer.from([eventType])],
    PROGRAM_PINOCCHIO,
  );
}

function encodeBorshString(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}
function rightPad8(s) {
  const b = Buffer.alloc(8);
  Buffer.from(s, 'ascii').copy(b);
  return b;
}

async function step1_registerAgent() {
  console.log(`\n[1/2] register_agent name="${AGENT_NAME}"`);
  const idl = JSON.parse(
    readFileSync('./target/idl/agent_registry.json', 'utf-8'),
  );
  const coder = new BorshCoder(idl);
  const data = coder.instruction.encode('register_agent', {
    name: AGENT_NAME,
    did_commitment: Array.from(Buffer.alloc(32, 7)),
    did_uri: `https://kolibri.com.br/did/${AGENT_NAME}`,
    _permissions: 0,
  });
  const [agentPda] = deriveAgentPda(authority.publicKey, AGENT_NAME);
  console.log(`     agent PDA: ${agentPda.toBase58()}`);

  const ix = new TransactionInstruction({
    programId: PROGRAM_AGENT_REGISTRY,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: agentPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
  console.log(`     tx: ${sig}`);
  console.log(`     https://solscan.io/tx/${sig}?cluster=devnet`);
  return agentPda;
}

async function step2_submitCannabisEvent(agentPda) {
  const batchId = randomBytes(16);
  const EVENT_TYPE_MOTHER_REGISTERED = 2;
  console.log(`\n[2/2] submit_cannabis_event type=MOTHER_REGISTERED batch=${batchId.toString('hex').slice(0, 16)}…`);
  const [eventPda] = deriveCannabisEventPda(batchId, EVENT_TYPE_MOTHER_REGISTERED);
  console.log(`     event PDA: ${eventPda.toBase58()}`);

  const payloadHash = createHash('sha256').update(`smoke-${Date.now()}`).digest();
  const storageUri = `ipfs://QmSmoke${Date.now()}`;
  const cultivarCode = rightPad8('HEM:CBD1');
  const emittedAt = Buffer.alloc(8);
  emittedAt.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 0);

  const data = Buffer.concat([
    Buffer.from([0x06]),               // selector
    batchId,                            // batch_id (16)
    Buffer.from([EVENT_TYPE_MOTHER_REGISTERED]),  // event_type
    Buffer.alloc(16),                   // parent_batch_id (zeros = root)
    payloadHash,                        // payload_hash (32)
    encodeBorshString(storageUri),      // storage_uri (Borsh)
    cultivarCode,                       // cultivar_code (8)
    emittedAt,                          // emitted_at (i64 LE)
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_PINOCCHIO,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
      { pubkey: agentPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
  console.log(`     tx: ${sig}`);
  console.log(`     https://solscan.io/tx/${sig}?cluster=devnet`);

  // Read back account
  const acct = await conn.getAccountInfo(eventPda);
  if (!acct) throw new Error('event PDA empty after anchor!');
  console.log(`     account owner: ${acct.owner.toBase58()}`);
  console.log(`     account size: ${acct.data.length} bytes`);
  const expectedDisc = Buffer.from([201, 187, 134, 71, 250, 109, 18, 245]);
  if (!Buffer.from(acct.data.slice(0, 8)).equals(expectedDisc)) {
    throw new Error('CannabisEvent discriminator mismatch!');
  }
  console.log(`     discriminator OK ✓`);
  return { batchId, eventPda, sig };
}

async function main() {
  console.log(`Smoke test devnet — selector 0x06 submit_cannabis_event`);
  console.log(`  RPC:       ${RPC}`);
  console.log(`  authority: ${authority.publicKey.toBase58()}`);
  console.log(`  program:   ${PROGRAM_PINOCCHIO.toBase58()}`);

  const balanceBefore = await conn.getBalance(authority.publicKey);
  console.log(`  balance:   ${(balanceBefore / 1e9).toFixed(6)} SOL`);

  const agentPda = await step1_registerAgent();
  const result = await step2_submitCannabisEvent(agentPda);

  const balanceAfter = await conn.getBalance(authority.publicKey);
  const cost = (balanceBefore - balanceAfter) / 1e9;
  console.log(`\nDone. Cost: ${cost.toFixed(6)} SOL (rent + fees for 2 PDAs)`);

  const out = {
    timestamp: new Date().toISOString(),
    rpc: RPC,
    authority: authority.publicKey.toBase58(),
    program: PROGRAM_PINOCCHIO.toBase58(),
    agent: {
      name: AGENT_NAME,
      pda: agentPda.toBase58(),
    },
    cannabisEvent: {
      batchId: result.batchId.toString('hex'),
      eventType: 'MOTHER_REGISTERED',
      pda: result.eventPda.toBase58(),
      txSignature: result.sig,
    },
    costSOL: cost,
  };
  writeFileSync('smoke-cannabis-event-devnet-result.json', JSON.stringify(out, null, 2));
  console.log(`\nResult written to smoke-cannabis-event-devnet-result.json`);
}

main().catch((err) => {
  console.error(`\nfatal: ${err?.message ?? err}`);
  console.error(err?.stack ?? '');
  process.exit(1);
});
