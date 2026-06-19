/**
 * compliance-registry-pinocchio — selector 0x07 submit_kcs_snapshot
 *
 * Kolibri Score (KCS) monthly operational-health snapshot (2026-06-18).
 *
 * Coverage:
 *   - PDA derivation determinism per (tenant, period)
 *   - Agent-registry cross-program gating (worker must be registered)
 *   - Score bounds (each component + composite ≤ 10_000) enforced
 *   - Period validity (month 1..12, year 2000..4000) enforced
 *   - Idempotency: same (tenant, period) rejected on second submit
 *   - Persisted account carries the KcsSnapshot discriminator
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
import { PROGRAM_IDS, pinocchioIx, deriveAgentPda, deriveKcsSnapshotPda } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

// Custom error codes from programs/compliance-registry-pinocchio/src/lib.rs (err_kcs + err_cannabis)
const ERR_KCS_URI_TOO_LONG = 0x3101;
const ERR_INVALID_PERIOD = 0x3102;
const ERR_SCORE_OUT_OF_BOUNDS = 0x3103;
const ERR_SNAPSHOT_ALREADY_RECORDED = 0x3104;
const ERR_AGENT_WRONG_OWNER = 0x3003;
const ERR_AGENT_NOT_REGISTERED = 0x3004;

const agentCoder = new BorshCoder(agentIdl as any);

const COMMITMENT = createHash('sha256').update('kcs-poseidon-stub').digest();
// Weighted 30/25/20/15/10 over 5 components, all at 8000 bps → composite 8000.
const SCORES = [8000, 8000, 8000, 8000, 8000];
const COMPOSITE = 8000;
const PERIOD = 202606; // June 2026

async function boot(): Promise<ProgramTestContext> {
  return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
}

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

async function fundAuthority(context: ProgramTestContext, kp: Keypair, lamports = 5 * LAMPORTS_PER_SOL) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: context.payer.publicKey, toPubkey: kp.publicKey, lamports }),
  );
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `funding failed: ${JSON.stringify(r)}`).toBeNull();
}

function buildSubmitKcsIx(opts: {
  authority: PublicKey;
  agentPda: PublicKey;
  tenant: PublicKey;
  period?: number;
  scores?: number[];
  composite?: number;
  storageUri?: string;
  rawData?: Buffer; // bypass the client encoder to test on-chain rejects
}): TransactionInstruction {
  const period = opts.period ?? PERIOD;
  const [snapshotPda] = deriveKcsSnapshotPda(opts.tenant, period);
  const data =
    opts.rawData ??
    pinocchioIx.submitKcsSnapshot({
      tenant: opts.tenant.toBuffer(),
      period,
      kcsCommitment: COMMITMENT,
      scores: opts.scores ?? SCORES,
      composite: opts.composite ?? COMPOSITE,
      storageUri: opts.storageUri ?? 'shadow://kcs/202606',
    });
  return new TransactionInstruction({
    programId: PROGRAM_IDS.compliance_registry_pinocchio,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: snapshotPda, isSigner: false, isWritable: true },
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
  const tryFromString = (s: string): number | null => {
    const hex = s.match(/custom program error[:\s]*0x([0-9a-fA-F]+)/);
    if (hex) return parseInt(hex[1], 16);
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

describe('compliance-registry-pinocchio — selector 0x07 submit_kcs_snapshot', () => {
  let context: ProgramTestContext;
  let worker: Keypair; // the KCS worker authority (a registered agent)
  let workerAgentPda: PublicKey;
  let outsider: Keypair;
  let tenant: PublicKey;

  beforeAll(async () => {
    context = await boot();
    worker = Keypair.generate();
    outsider = Keypair.generate();
    tenant = Keypair.generate().publicKey;
    await fundAuthority(context, worker);
    await fundAuthority(context, outsider);
    workerAgentPda = await registerAgent(context, worker, 'kcs-worker:dpo2u');
  });

  it('records a monthly snapshot with deterministic PDA + discriminator', async () => {
    const [expectedPda] = deriveKcsSnapshotPda(tenant, PERIOD);
    const ix = buildSubmitKcsIx({ authority: worker.publicKey, agentPda: workerAgentPda, tenant });
    const r = await processOne(context, ix, [worker], worker);
    expect(r.result, `submit failed: ${JSON.stringify(r)}`).toBeNull();

    const acct = await context.banksClient.getAccount(expectedPda);
    expect(acct).not.toBeNull();
    expect(acct!.owner.equals(PROGRAM_IDS.compliance_registry_pinocchio)).toBe(true);
    const expectedDisc = Buffer.from([0xce, 0xc3, 0xf2, 0xdc, 0xd6, 0x36, 0x8c, 0xf6]);
    expect(Buffer.from(acct!.data.slice(0, 8)).equals(expectedDisc)).toBe(true);
  });

  it('rejects when authority is not in agent-registry (wrong owner)', async () => {
    const fakeAgent = Keypair.generate().publicKey;
    const ix = buildSubmitKcsIx({
      authority: outsider.publicKey,
      agentPda: fakeAgent,
      tenant: Keypair.generate().publicKey,
    });
    const r = await processOne(context, ix, [outsider], outsider);
    expect(extractCustomErrorCode(r)).toBe(ERR_AGENT_WRONG_OWNER);
  });

  it('rejects when agent.authority != signer', async () => {
    const ix = buildSubmitKcsIx({
      authority: outsider.publicKey,
      agentPda: workerAgentPda, // worker's agent, but outsider signs
      tenant: Keypair.generate().publicKey,
    });
    const r = await processOne(context, ix, [outsider], outsider);
    expect(extractCustomErrorCode(r)).toBe(ERR_AGENT_NOT_REGISTERED);
  });

  it('rejects a score component > 10_000 (out of bounds)', async () => {
    const ix = buildSubmitKcsIx({
      authority: worker.publicKey,
      agentPda: workerAgentPda,
      tenant: Keypair.generate().publicKey,
      scores: [10_001, 0, 0, 0, 0],
    });
    const r = await processOne(context, ix, [worker], worker);
    expect(extractCustomErrorCode(r)).toBe(ERR_SCORE_OUT_OF_BOUNDS);
  });

  it('rejects an invalid period (month 13)', async () => {
    const ix = buildSubmitKcsIx({
      authority: worker.publicKey,
      agentPda: workerAgentPda,
      tenant: Keypair.generate().publicKey,
      period: 202613, // month 13
    });
    const r = await processOne(context, ix, [worker], worker);
    expect(extractCustomErrorCode(r)).toBe(ERR_INVALID_PERIOD);
  });

  it('rejects storage_uri > 200 bytes', async () => {
    const tenant2 = Keypair.generate().publicKey;
    const tooLong = 'x'.repeat(201);
    const [snapshotPda] = deriveKcsSnapshotPda(tenant2, PERIOD);
    // bypass the client guard (which throws) to exercise the on-chain reject
    const len = Buffer.alloc(4);
    len.writeUInt32LE(201, 0);
    const period = Buffer.alloc(4);
    period.writeUInt32LE(PERIOD, 0);
    const rawData = Buffer.concat([
      Buffer.from([0x07]),
      tenant2.toBuffer(),
      period,
      COMMITMENT,
      Buffer.concat(SCORES.map((s) => { const b = Buffer.alloc(4); b.writeUInt32LE(s, 0); return b; })),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(COMPOSITE, 0); return b; })(),
      len,
      Buffer.from(tooLong, 'utf8'),
    ]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry_pinocchio,
      keys: [
        { pubkey: worker.publicKey, isSigner: true, isWritable: true },
        { pubkey: snapshotPda, isSigner: false, isWritable: true },
        { pubkey: workerAgentPda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: rawData,
    });
    const r = await processOne(context, ix, [worker], worker);
    expect(extractCustomErrorCode(r)).toBe(ERR_KCS_URI_TOO_LONG);
  });

  it('rejects double-submission for the same (tenant, period)', async () => {
    // The first test already wrote (tenant, PERIOD); re-submitting must fail.
    const ix = buildSubmitKcsIx({ authority: worker.publicKey, agentPda: workerAgentPda, tenant });
    const r = await processOne(context, ix, [worker], worker);
    expect(extractCustomErrorCode(r)).toBe(ERR_SNAPSHOT_ALREADY_RECORDED);
  });
});
