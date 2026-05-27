/**
 * compliance-registry-pinocchio — selector 0x06 submit_cannabis_event
 *
 * Kolibri seed-to-sale plant traceability (2026-05-27).
 *
 * Coverage:
 *   - PDA derivation determinism per (batch_id, event_type)
 *   - Agent-registry cross-program gating (must be registered)
 *   - 15 event types accepted; type 0 + type 16 rejected
 *   - Idempotency: same (batch_id, event_type) rejected on second submit
 *   - Parent linkage via parent_batch_id (genealogy)
 *   - Storage URI max length (200) enforced
 *   - Multi-event flow on the same batch (full lifecycle smoke)
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, it, expect, beforeAll } from 'vitest';
import { startAnchor, ProgramTestContext } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

import agentIdl from '../target/idl/agent_registry.json' assert { type: 'json' };
import {
  PROGRAM_IDS,
  pinocchioIx,
  CANNABIS_EVENT_TYPE,
  deriveCannabisEventPda,
  deriveAgentPda,
  randomBatchId,
  ROOT_BATCH_ID,
} from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

// Custom error codes from programs/compliance-registry-pinocchio/src/lib.rs
const ERR_CANNABIS_URI_TOO_LONG = 0x3001;
const ERR_INVALID_EVENT_TYPE = 0x3002;
const ERR_AGENT_WRONG_OWNER = 0x3003;
const ERR_AGENT_NOT_REGISTERED = 0x3004;
const ERR_EVENT_ALREADY_RECORDED = 0x3005;

const agentCoder = new BorshCoder(agentIdl as any);

async function boot(): Promise<ProgramTestContext> {
  return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
}

/** Register an agent in agent-registry for the given authority. Returns the agent PDA. */
async function registerAgent(
  context: ProgramTestContext,
  authority: Keypair,
  name: string,
): Promise<PublicKey> {
  const [agentPda] = deriveAgentPda(authority.publicKey, name);
  const data = agentCoder.instruction.encode('register_agent', {
    name,
    did_commitment: Array.from(Buffer.alloc(32, 7)),
    did_uri: `https://dpo2u.com/did/${name}`,
    _permissions: 0,
  });
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.agent_registry,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: agentPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `register_agent(${name}) failed: ${JSON.stringify(r)}`).toBeNull();
  return agentPda;
}

/** Fund authority with SOL so it can pay rent for the event PDA. */
async function fundAuthority(context: ProgramTestContext, kp: Keypair, lamports = 5 * LAMPORTS_PER_SOL) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: context.payer.publicKey,
      toPubkey: kp.publicKey,
      lamports,
    }),
  );
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `funding ${kp.publicKey.toBase58()} failed: ${JSON.stringify(r)}`).toBeNull();
}

function buildSubmitCannabisEventIx(opts: {
  authority: PublicKey;
  agentPda: PublicKey;
  batchId: Buffer;
  eventType: number;
  parentBatchId?: Buffer;
  payloadHash?: Buffer;
  storageUri?: string;
  cultivarCode?: Buffer;
  emittedAt?: bigint;
}): TransactionInstruction {
  const batchId = opts.batchId;
  const parentBatchId = opts.parentBatchId ?? ROOT_BATCH_ID;
  const payloadHash = opts.payloadHash ?? createHash('sha256').update('seed-payload').digest();
  const storageUri = opts.storageUri ?? 'ipfs://QmCannabisEventDemo';
  const cultivarCode = opts.cultivarCode ?? Buffer.concat([Buffer.from('HEM:CBD1', 'ascii')]);
  const emittedAt = opts.emittedAt ?? BigInt(1_700_000_000);

  const [eventPda] = deriveCannabisEventPda(batchId, opts.eventType);

  const data = pinocchioIx.submitCannabisEvent({
    batchId,
    eventType: opts.eventType,
    parentBatchId,
    payloadHash,
    storageUri,
    cultivarCode,
    emittedAt,
  });

  return new TransactionInstruction({
    programId: PROGRAM_IDS.compliance_registry_pinocchio,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
      { pubkey: opts.agentPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function processOne(
  context: ProgramTestContext,
  ix: TransactionInstruction,
  signers: Keypair[],
  feePayer: Keypair,
): Promise<any> {
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0];
  tx.feePayer = feePayer.publicKey;
  tx.sign(...signers);
  return context.banksClient.tryProcessTransaction(tx);
}

function extractCustomErrorCode(result: any): number | null {
  // Try multiple paths: (1) JSON repr of result.result, (2) log messages from meta.
  const tryFromString = (s: string): number | null => {
    // hex form ("custom program error: 0x3003")
    const hex = s.match(/custom program error[:\s]*0x([0-9a-fA-F]+)/);
    if (hex) return parseInt(hex[1], 16);
    // decimal form ("Custom(12291)" or "Custom":12291)
    const dec = s.match(/Custom[":(\s]*(\d+)/);
    if (dec) return Number(dec[1]);
    return null;
  };
  if (result?.result) {
    const s = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    const fromResult = tryFromString(s);
    if (fromResult !== null) return fromResult;
  }
  const logs: string[] = result?.meta?.logMessages ?? [];
  for (const line of logs) {
    const fromLog = tryFromString(line);
    if (fromLog !== null) return fromLog;
  }
  return null;
}

// =============================================================================
// Tests
// =============================================================================

describe('compliance-registry-pinocchio — selector 0x06 submit_cannabis_event', () => {
  let context: ProgramTestContext;
  let cultivator: Keypair;
  let cultivatorAgentPda: PublicKey;
  let outsider: Keypair; // not registered in agent-registry

  beforeAll(async () => {
    context = await boot();
    cultivator = Keypair.generate();
    outsider = Keypair.generate();

    await fundAuthority(context, cultivator);
    await fundAuthority(context, outsider);

    cultivatorAgentPda = await registerAgent(context, cultivator, 'cultivator:00.000.000/0001-00');
  });

  it('records SEED_PLANTED event with deterministic PDA', async () => {
    const batchId = randomBatchId();
    const [expectedPda] = deriveCannabisEventPda(batchId, CANNABIS_EVENT_TYPE.SEED_PLANTED);

    const ix = buildSubmitCannabisEventIx({
      authority: cultivator.publicKey,
      agentPda: cultivatorAgentPda,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.SEED_PLANTED,
    });

    const r = await processOne(context, ix, [cultivator], cultivator);
    expect(r.result, `submit failed: ${JSON.stringify(r)}`).toBeNull();

    const acct = await context.banksClient.getAccount(expectedPda);
    expect(acct).not.toBeNull();
    expect(acct!.data.length).toBeGreaterThan(8);
    expect(acct!.owner.equals(PROGRAM_IDS.compliance_registry_pinocchio)).toBe(true);
    // CannabisEvent discriminator from lib.rs
    const expectedDisc = Buffer.from([201, 187, 134, 71, 250, 109, 18, 245]);
    expect(Buffer.from(acct!.data.slice(0, 8)).equals(expectedDisc)).toBe(true);
  });

  it('rejects when authority is not in agent-registry', async () => {
    const batchId = randomBatchId();
    // Construct a fake agent PDA owned by SystemProgram (wrong owner)
    const fakeAgent = Keypair.generate().publicKey;
    const ix = buildSubmitCannabisEventIx({
      authority: outsider.publicKey,
      agentPda: fakeAgent,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.MOTHER_REGISTERED,
    });
    const r = await processOne(context, ix, [outsider], outsider);
    expect(extractCustomErrorCode(r)).toBe(ERR_AGENT_WRONG_OWNER);
  });

  it('rejects when agent.authority != signer', async () => {
    // outsider signs but passes cultivator's agent PDA
    const batchId = randomBatchId();
    const ix = buildSubmitCannabisEventIx({
      authority: outsider.publicKey,
      agentPda: cultivatorAgentPda,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.SEED_PLANTED,
    });
    const r = await processOne(context, ix, [outsider], outsider);
    expect(extractCustomErrorCode(r)).toBe(ERR_AGENT_NOT_REGISTERED);
  });

  it('rejects event_type = 0', async () => {
    const batchId = randomBatchId();
    // Manually build with eventType=0 (helper throws, so bypass it)
    const dataWithZero = Buffer.concat([
      Buffer.from([0x06]),
      batchId,
      Buffer.from([0]), // event_type = 0 (invalid)
      ROOT_BATCH_ID,
      createHash('sha256').update('x').digest(),
      // empty storage_uri (Borsh string = u32 len + bytes)
      Buffer.from([0, 0, 0, 0]),
      Buffer.alloc(8), // cultivar_code
      Buffer.alloc(8), // emitted_at
    ]);
    const [eventPda] = deriveCannabisEventPda(batchId, 0);
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry_pinocchio,
      keys: [
        { pubkey: cultivator.publicKey, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: cultivatorAgentPda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: dataWithZero,
    });
    const r = await processOne(context, ix, [cultivator], cultivator);
    expect(extractCustomErrorCode(r)).toBe(ERR_INVALID_EVENT_TYPE);
  });

  it('rejects event_type > 15', async () => {
    const batchId = randomBatchId();
    const dataWithSixteen = Buffer.concat([
      Buffer.from([0x06]),
      batchId,
      Buffer.from([16]), // event_type = 16 (invalid)
      ROOT_BATCH_ID,
      createHash('sha256').update('x').digest(),
      Buffer.from([0, 0, 0, 0]),
      Buffer.alloc(8),
      Buffer.alloc(8),
    ]);
    const [eventPda] = deriveCannabisEventPda(batchId, 16);
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry_pinocchio,
      keys: [
        { pubkey: cultivator.publicKey, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: cultivatorAgentPda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: dataWithSixteen,
    });
    const r = await processOne(context, ix, [cultivator], cultivator);
    expect(extractCustomErrorCode(r)).toBe(ERR_INVALID_EVENT_TYPE);
  });

  it('rejects double-submission of same (batch_id, event_type)', async () => {
    const batchId = randomBatchId();
    const ix1 = buildSubmitCannabisEventIx({
      authority: cultivator.publicKey,
      agentPda: cultivatorAgentPda,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.VEGETATION_START,
    });
    const r1 = await processOne(context, ix1, [cultivator], cultivator);
    expect(r1.result).toBeNull();

    const ix2 = buildSubmitCannabisEventIx({
      authority: cultivator.publicKey,
      agentPda: cultivatorAgentPda,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.VEGETATION_START,
    });
    const r2 = await processOne(context, ix2, [cultivator], cultivator);
    expect(extractCustomErrorCode(r2)).toBe(ERR_EVENT_ALREADY_RECORDED);
  });

  it('rejects storage_uri > 200 bytes', async () => {
    const batchId = randomBatchId();
    const tooLong = 'x'.repeat(201);
    expect(() =>
      pinocchioIx.submitCannabisEvent({
        batchId,
        eventType: CANNABIS_EVENT_TYPE.HARVEST,
        parentBatchId: ROOT_BATCH_ID,
        payloadHash: createHash('sha256').update('x').digest(),
        storageUri: tooLong,
        cultivarCode: Buffer.alloc(8),
        emittedAt: 0n,
      }),
    ).toThrow(/too long/i);

    // Bypass the client check to test the on-chain reject
    const data = Buffer.concat([
      Buffer.from([0x06]),
      batchId,
      Buffer.from([CANNABIS_EVENT_TYPE.HARVEST]),
      ROOT_BATCH_ID,
      createHash('sha256').update('x').digest(),
      (() => {
        const len = Buffer.alloc(4);
        len.writeUInt32LE(201, 0);
        return Buffer.concat([len, Buffer.from(tooLong, 'utf8')]);
      })(),
      Buffer.alloc(8),
      Buffer.alloc(8),
    ]);
    const [eventPda] = deriveCannabisEventPda(batchId, CANNABIS_EVENT_TYPE.HARVEST);
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry_pinocchio,
      keys: [
        { pubkey: cultivator.publicKey, isSigner: true, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: cultivatorAgentPda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });
    const r = await processOne(context, ix, [cultivator], cultivator);
    expect(extractCustomErrorCode(r)).toBe(ERR_CANNABIS_URI_TOO_LONG);
  });

  it('records full lifecycle (15 events on one batch genealogy)', async () => {
    const motherBatch = randomBatchId();
    const cloneBatch = randomBatchId();

    // 1. mother registered
    let r = await processOne(
      context,
      buildSubmitCannabisEventIx({
        authority: cultivator.publicKey,
        agentPda: cultivatorAgentPda,
        batchId: motherBatch,
        eventType: CANNABIS_EVENT_TYPE.MOTHER_REGISTERED,
      }),
      [cultivator],
      cultivator,
    );
    expect(r.result).toBeNull();

    // 2. clone cut — parent = mother
    r = await processOne(
      context,
      buildSubmitCannabisEventIx({
        authority: cultivator.publicKey,
        agentPda: cultivatorAgentPda,
        batchId: cloneBatch,
        eventType: CANNABIS_EVENT_TYPE.CLONE_CUT,
        parentBatchId: motherBatch,
      }),
      [cultivator],
      cultivator,
    );
    expect(r.result).toBeNull();

    // 3-15. all other event types on the clone batch (skip CLONE_CUT and MOTHER_REGISTERED already done)
    const remaining = [
      CANNABIS_EVENT_TYPE.VEGETATION_START,
      CANNABIS_EVENT_TYPE.FLOWERING_START,
      CANNABIS_EVENT_TYPE.HARVEST,
      CANNABIS_EVENT_TYPE.DRYING_START,
      CANNABIS_EVENT_TYPE.CURING_START,
      CANNABIS_EVENT_TYPE.LAB_SAMPLE_TAKEN,
      CANNABIS_EVENT_TYPE.LAB_RESULT_RELEASED,
      CANNABIS_EVENT_TYPE.PACKAGED,
      CANNABIS_EVENT_TYPE.TRANSFERRED,
      CANNABIS_EVENT_TYPE.DISPENSED,
      CANNABIS_EVENT_TYPE.RECALLED,
      CANNABIS_EVENT_TYPE.DESTROYED,
      CANNABIS_EVENT_TYPE.SEED_PLANTED, // also record on the clone batch
    ];
    for (const evtType of remaining) {
      const ix = buildSubmitCannabisEventIx({
        authority: cultivator.publicKey,
        agentPda: cultivatorAgentPda,
        batchId: cloneBatch,
        eventType: evtType,
      });
      r = await processOne(context, ix, [cultivator], cultivator);
      expect(r.result, `event_type ${evtType} failed: ${JSON.stringify(r)}`).toBeNull();
    }

    // Verify all 14 PDAs (1 mother + 13 on clone) materialised
    for (const evtType of [CANNABIS_EVENT_TYPE.MOTHER_REGISTERED]) {
      const [pda] = deriveCannabisEventPda(motherBatch, evtType);
      const acct = await context.banksClient.getAccount(pda);
      expect(acct, `mother evt ${evtType} PDA empty`).not.toBeNull();
    }
    for (const evtType of [CANNABIS_EVENT_TYPE.CLONE_CUT, ...remaining]) {
      const [pda] = deriveCannabisEventPda(cloneBatch, evtType);
      const acct = await context.banksClient.getAccount(pda);
      expect(acct, `clone evt ${evtType} PDA empty`).not.toBeNull();
    }
  });
});
