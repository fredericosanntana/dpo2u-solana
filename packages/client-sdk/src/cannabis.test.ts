/**
 * Pure-helpers smoke tests for DPO2UCannabisClient — no network.
 *
 * Verifies PDA derivation determinism, encoding correctness, and validation
 * boundaries. The actual on-chain submission flow is covered by the
 * solana-programs bankrun test `cannabis-event-pinocchio.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

import {
  CANNABIS_EVENT_TYPE,
  ROOT_BATCH_ID,
  DPO2UCannabisClient,
  deriveCannabisEventPda,
  deriveAgentPdaFromCannabis,
  encodeSubmitCannabisEvent,
  buildSubmitCannabisEventIx,
} from './index.js';

const fakeSigner = Keypair.generate();

function rand16(): Uint8Array {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

describe('DPO2UCannabisClient — pure helpers (no network)', () => {
  it('CANNABIS_EVENT_TYPE has 15 distinct values 1..15', () => {
    const values = Object.values(CANNABIS_EVENT_TYPE);
    expect(values).toHaveLength(15);
    expect(new Set(values).size).toBe(15);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(15);
  });

  it('ROOT_BATCH_ID is 16 zero bytes', () => {
    expect(ROOT_BATCH_ID.length).toBe(16);
    expect(ROOT_BATCH_ID.every((b) => b === 0)).toBe(true);
  });

  it('deriveCannabisEventPda is deterministic per (batch, type)', () => {
    const batch = rand16();
    const [pda1] = deriveCannabisEventPda(batch, CANNABIS_EVENT_TYPE.HARVEST);
    const [pda2] = deriveCannabisEventPda(batch, CANNABIS_EVENT_TYPE.HARVEST);
    expect(pda1.equals(pda2)).toBe(true);

    const [pda3] = deriveCannabisEventPda(batch, CANNABIS_EVENT_TYPE.DRYING_START);
    expect(pda1.equals(pda3)).toBe(false); // different event type → different PDA
  });

  it('deriveCannabisEventPda differs per batch', () => {
    const batchA = rand16();
    const batchB = rand16();
    const [pdaA] = deriveCannabisEventPda(batchA, CANNABIS_EVENT_TYPE.HARVEST);
    const [pdaB] = deriveCannabisEventPda(batchB, CANNABIS_EVENT_TYPE.HARVEST);
    expect(pdaA.equals(pdaB)).toBe(false);
  });

  it('deriveAgentPdaFromCannabis matches agent-registry seed pattern', () => {
    const auth = Keypair.generate().publicKey;
    const [pda1] = deriveAgentPdaFromCannabis(auth, 'cultivator:00.000.000/0001-00');
    const [pda2] = deriveAgentPdaFromCannabis(auth, 'cultivator:00.000.000/0001-00');
    expect(pda1.equals(pda2)).toBe(true);

    const [pda3] = deriveAgentPdaFromCannabis(auth, 'dispensary:00.000.000/0001-00');
    expect(pda1.equals(pda3)).toBe(false);
  });

  it('encodeSubmitCannabisEvent has correct byte layout', () => {
    const batchId = new Uint8Array(16).fill(0xAB);
    const payloadHash = createHash('sha256').update('seed-payload').digest();
    const data = encodeSubmitCannabisEvent({
      batchId,
      eventType: CANNABIS_EVENT_TYPE.SEED_PLANTED,
      payloadHash,
      storageUri: 'ipfs://Qm',
      cultivarCode: 'HEM',
      emittedAt: 1700000000n,
    });
    // selector(1) + batch(16) + type(1) + parent(16) + hash(32) + uri_len(4) + uri(9) + cult(8) + emitted(8) = 95
    expect(data.length).toBe(95);
    expect(data[0]).toBe(0x06);
    expect(data[17]).toBe(CANNABIS_EVENT_TYPE.SEED_PLANTED);
    // parent_batch_id defaults to zero
    expect(data.slice(18, 34).every((b) => b === 0)).toBe(true);
    // cultivar_code is right-padded with zero
    const cultOffset = 1 + 16 + 1 + 16 + 32 + 4 + 9;
    expect(data.slice(cultOffset, cultOffset + 3).toString('ascii')).toBe('HEM');
    expect(data.slice(cultOffset + 3, cultOffset + 8).every((b) => b === 0)).toBe(true);
  });

  it('rejects event_type out of range', () => {
    const batchId = new Uint8Array(16);
    const payloadHash = new Uint8Array(32);
    expect(() =>
      encodeSubmitCannabisEvent({
        batchId,
        eventType: 0 as any,
        payloadHash,
        storageUri: '',
        cultivarCode: '',
        emittedAt: 0n,
      }),
    ).toThrow(/out of range/);
    expect(() =>
      encodeSubmitCannabisEvent({
        batchId,
        eventType: 16 as any,
        payloadHash,
        storageUri: '',
        cultivarCode: '',
        emittedAt: 0n,
      }),
    ).toThrow(/out of range/);
  });

  it('rejects storage_uri > 200 bytes', () => {
    expect(() =>
      encodeSubmitCannabisEvent({
        batchId: new Uint8Array(16),
        eventType: CANNABIS_EVENT_TYPE.HARVEST,
        payloadHash: new Uint8Array(32),
        storageUri: 'x'.repeat(201),
        cultivarCode: '',
        emittedAt: 0n,
      }),
    ).toThrow(/too long/);
  });

  it('rejects payloadHash != 32 bytes', () => {
    expect(() =>
      encodeSubmitCannabisEvent({
        batchId: new Uint8Array(16),
        eventType: CANNABIS_EVENT_TYPE.HARVEST,
        payloadHash: new Uint8Array(31),
        storageUri: 'ipfs://x',
        cultivarCode: '',
        emittedAt: 0n,
      }),
    ).toThrow(/32 bytes/);
  });

  it('buildSubmitCannabisEventIx creates instruction with correct accounts', () => {
    const auth = Keypair.generate().publicKey;
    const agentPda = Keypair.generate().publicKey;
    const batchId = rand16();
    const ix = buildSubmitCannabisEventIx({
      authority: auth,
      agentPda,
      batchId,
      eventType: CANNABIS_EVENT_TYPE.PACKAGED,
      payloadHash: createHash('sha256').update('p').digest(),
      storageUri: 'ipfs://Qm',
      cultivarCode: 'CBD',
      emittedAt: 1700000000n,
    });
    expect(ix.keys).toHaveLength(6);
    expect(ix.keys[0].pubkey.equals(auth)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[2].pubkey.equals(agentPda)).toBe(true);
    expect(ix.keys[2].isWritable).toBe(false);
    expect(ix.programId.toBase58()).toBe('FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8');
    expect(ix.data[0]).toBe(0x06);
  });

  it('client.agentPdaFor wraps deriveAgentPdaFromCannabis', () => {
    const client = new DPO2UCannabisClient({ cluster: 'localnet', signer: fakeSigner });
    const pda1 = client.agentPdaFor('cultivator:foo');
    const [pda2] = deriveAgentPdaFromCannabis(fakeSigner.publicKey, 'cultivator:foo');
    expect(pda1.equals(pda2)).toBe(true);
  });
});
