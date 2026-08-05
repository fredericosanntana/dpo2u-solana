/**
 * anchor-cannabis-event-real.mjs — anchor um evento REAL na devnet.
 *
 * Diferente do smoke test, este script:
 *   1. Lê um JSON estruturado do payload off-chain (event-schemas.md)
 *   2. Canonicaliza (JCS RFC 8785 simplificado) + sha256 → payload_hash
 *   3. (Demo) embute o canonical_json local em /tmp/kolibri-payloads/<hash>.json
 *      em produção: subir pra Shadow Drive ou IPFS
 *   4. Anchora on-chain com o hash + storage_uri
 *
 * Uso:
 *   node anchor-cannabis-event-real.mjs --type MOTHER_REGISTERED \
 *     --batch <ulid_or_hex_16> --payload /path/to/payload.json \
 *     --cultivar HEM:CBD1 [--parent <batch_id_pai>] [--agent <name>]
 *
 * Se --payload não for passado, usa stdin.
 */

import {
  Connection, Keypair, PublicKey, SystemProgram,
  SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
  Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { ulid } from 'ulid';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.ANCHOR_AUTHORITY_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
const PROGRAM_PINOCCHIO = new PublicKey('FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8');
const PROGRAM_AGENT_REGISTRY = new PublicKey('5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7');

const EVENT_TYPES = {
  SEED_PLANTED:1, MOTHER_REGISTERED:2, CLONE_CUT:3, VEGETATION_START:4,
  FLOWERING_START:5, HARVEST:6, DRYING_START:7, CURING_START:8,
  LAB_SAMPLE_TAKEN:9, LAB_RESULT_RELEASED:10, PACKAGED:11, TRANSFERRED:12,
  DISPENSED:13, RECALLED:14, DESTROYED:15,
};

// -- CLI args ----------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      opts[args[i].slice(2)] = args[i+1];
      i++;
    }
  }
  if (!opts.type) { console.error('--type required (one of: ' + Object.keys(EVENT_TYPES).join(',') + ')'); process.exit(1); }
  if (!EVENT_TYPES[opts.type]) { console.error('invalid --type ' + opts.type); process.exit(1); }
  if (!opts.cultivar) { console.error('--cultivar required (e.g. HEM:CBD1)'); process.exit(1); }
  return opts;
}

// -- ULID → 16 bytes ---------------------------------------------------------
function ulidToBytes(u) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const map = Object.fromEntries(alphabet.split('').map((c,i) => [c, i]));
  let bits = '';
  for (const ch of u.toUpperCase()) bits += map[ch].toString(2).padStart(5,'0');
  bits = bits.slice(0, 128);
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(bits.slice(i*8, (i+1)*8), 2);
  return out;
}

// -- Canonical JSON (JCS-style) ----------------------------------------------
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

// -- Borsh helpers ------------------------------------------------------------
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

// -- PDA derivers -------------------------------------------------------------
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

// -- Auto-register agent if needed -------------------------------------------
async function ensureAgent(conn, authority, agentName) {
  const [agentPda] = deriveAgentPda(authority.publicKey, agentName);
  const existing = await conn.getAccountInfo(agentPda);
  if (existing && existing.owner.equals(PROGRAM_AGENT_REGISTRY)) {
    return agentPda;
  }
  const idl = JSON.parse(readFileSync('./target/idl/agent_registry.json', 'utf-8'));
  const coder = new BorshCoder(idl);
  const data = coder.instruction.encode('register_agent', {
    name: agentName,
    did_commitment: Array.from(Buffer.alloc(32)),
    did_uri: `https://kolibri.com.br/did/${encodeURIComponent(agentName)}`,
    _permissions: 0,
  });
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
  console.log(`  [register_agent] ${agentName} → PDA ${agentPda.toBase58()} (tx ${sig.slice(0,12)}…)`);
  return agentPda;
}

// -- Main --------------------------------------------------------------------
async function main() {
  const opts = parseArgs();
  const eventType = EVENT_TYPES[opts.type];

  // Read payload from --payload file or stdin
  let payloadRaw;
  if (opts.payload) {
    payloadRaw = readFileSync(opts.payload, 'utf-8');
  } else {
    payloadRaw = readFileSync(0, 'utf-8');  // stdin
  }
  const payload = JSON.parse(payloadRaw);
  if (!payload.evt || payload.evt !== opts.type) {
    console.warn(`! payload.evt="${payload.evt}" doesn't match --type "${opts.type}" — using --type`);
  }

  // Canonicalize + hash
  const canonical = canonicalize(payload);
  const payloadHash = createHash('sha256').update(canonical).digest();
  console.log(`Payload hash: ${payloadHash.toString('hex')}`);
  console.log(`Canonical bytes: ${canonical.length}`);

  // Store payload locally (in production: Shadow Drive / IPFS)
  const storageRoot = '/tmp/kolibri-payloads';
  if (!existsSync(storageRoot)) mkdirSync(storageRoot, { recursive: true });
  const storagePath = `${storageRoot}/${payloadHash.toString('hex')}.json`;
  writeFileSync(storagePath, canonical);
  const storageUri = `file://${storagePath}`;
  console.log(`Stored at: ${storageUri}`);

  // Batch ID
  let batchIdBytes;
  if (opts.batch) {
    if (opts.batch.length === 26) batchIdBytes = ulidToBytes(opts.batch);
    else if (opts.batch.length === 32) batchIdBytes = Buffer.from(opts.batch, 'hex');
    else throw new Error('--batch must be 26-char ULID or 32-char hex');
  } else {
    const newUlid = ulid();
    console.log(`Generated batch ULID: ${newUlid}`);
    batchIdBytes = ulidToBytes(newUlid);
  }
  console.log(`Batch ID (hex): ${batchIdBytes.toString('hex')}`);

  const parentBytes = opts.parent ?
    (opts.parent.length === 26 ? ulidToBytes(opts.parent) : Buffer.from(opts.parent, 'hex'))
    : Buffer.alloc(16);

  // Authority + agent
  const authority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8'))),
  );
  const conn = new Connection(RPC, 'confirmed');
  const agentName = opts.agent || `cultivator:${authority.publicKey.toBase58().slice(0,8)}`;
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Agent: ${agentName}`);

  const agentPda = await ensureAgent(conn, authority, agentName);

  // Build + send instruction
  const [eventPda] = deriveCannabisEventPda(batchIdBytes, eventType);
  const emittedAt = Buffer.alloc(8);
  emittedAt.writeBigInt64LE(BigInt(payload.ts || Math.floor(Date.now()/1000)), 0);

  const data = Buffer.concat([
    Buffer.from([0x06]),
    batchIdBytes,
    Buffer.from([eventType]),
    parentBytes,
    payloadHash,
    encodeBorshString(storageUri),
    rightPad8(opts.cultivar),
    emittedAt,
  ]);

  console.log(`\nAnchoring event...`);
  console.log(`  type: ${opts.type} (${eventType})`);
  console.log(`  event PDA: ${eventPda.toBase58()}`);
  if (opts.parent) console.log(`  parent batch: ${opts.parent}`);

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
  console.log(`  tx: ${sig}`);
  console.log(`  https://solscan.io/tx/${sig}?cluster=devnet`);

  const out = {
    timestamp: new Date().toISOString(),
    event: {
      type: opts.type,
      type_code: eventType,
      batch_id_hex: batchIdBytes.toString('hex'),
      parent_batch_id_hex: parentBytes.toString('hex'),
      pda: eventPda.toBase58(),
      tx_signature: sig,
      payload_hash: payloadHash.toString('hex'),
      storage_uri: storageUri,
      cultivar_code: opts.cultivar,
      authority: authority.publicKey.toBase58(),
      agent_name: agentName,
      agent_pda: agentPda.toBase58(),
    },
    payload_canonical_preview: canonical.length > 500 ? canonical.slice(0, 500) + '…' : canonical,
  };
  console.log(`\nDone.`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error(`fatal: ${err?.message ?? err}`); console.error(err?.stack); process.exit(1); });
