/**
 * Pure-helpers smoke tests for the KCS client — no network.
 *
 * PDA determinism, encode layout, composite math, and Poseidon commitment
 * determinism + recompute. On-chain submission is covered by the solana-programs
 * bankrun test `kcs-snapshot-pinocchio.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import {
  KCS_COMPONENT_WEIGHTS,
  scoresToArray,
  computeComposite,
  deriveKcsSnapshotPda,
  computeKcsCommitment,
  encodeSubmitKcsSnapshot,
  type KcsScores,
} from './index.js';

const tenant = Keypair.generate().publicKey;
const PERIOD = 202606;
const scores: KcsScores = {
  txVolume: 8000,
  dispensingTime: 7000,
  timeInProtocol: 9000,
  cancellationRate: 6000,
  cloakAdoption: 5000,
};

describe('KCS helpers (no network)', () => {
  it('component weights sum to 10_000 (30/25/20/15/10)', () => {
    expect(KCS_COMPONENT_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect([...KCS_COMPONENT_WEIGHTS]).toEqual([3000, 2500, 2000, 1500, 1000]);
  });

  it('scoresToArray preserves canonical order', () => {
    expect(scoresToArray(scores)).toEqual([8000, 7000, 9000, 6000, 5000]);
  });

  it('computeComposite applies the weights (floor)', () => {
    // 8000*0.30 + 7000*0.25 + 9000*0.20 + 6000*0.15 + 5000*0.10
    // = 2400 + 1750 + 1800 + 900 + 500 = 7350
    expect(computeComposite(scores)).toBe(7350);
  });

  it('derives a deterministic snapshot PDA per (tenant, period)', () => {
    const [a] = deriveKcsSnapshotPda(tenant, PERIOD);
    const [b] = deriveKcsSnapshotPda(tenant, PERIOD);
    expect(a.equals(b)).toBe(true);
    const [c] = deriveKcsSnapshotPda(tenant, 202607);
    expect(a.equals(c)).toBe(false);
  });

  it('computes a deterministic 32-byte Poseidon commitment', async () => {
    const composite = computeComposite(scores);
    const c1 = await computeKcsCommitment({ tenant, period: PERIOD, scores, composite });
    const c2 = await computeKcsCommitment({ tenant, period: PERIOD, scores, composite });
    expect(c1).toHaveLength(32);
    expect(c1.equals(c2)).toBe(true);
    // A changed score changes the commitment.
    const c3 = await computeKcsCommitment({
      tenant,
      period: PERIOD,
      scores: { ...scores, txVolume: 8001 },
      composite,
    });
    expect(c1.equals(c3)).toBe(false);
  });

  it('encodes selector 0x07 with the correct byte layout', () => {
    const commitment = Buffer.alloc(32, 9);
    const data = encodeSubmitKcsSnapshot({
      tenant,
      period: PERIOD,
      kcsCommitment: commitment,
      scores,
      composite: 7350,
      storageUri: 'shadow://kcs/202606',
    });
    // selector(1) + tenant(32) + period(4) + commitment(32) + scores(20) + composite(4) + (4 + uriLen)
    const uri = 'shadow://kcs/202606';
    expect(data[0]).toBe(0x07);
    expect(data.subarray(1, 33).equals(tenant.toBuffer())).toBe(true);
    expect(data.readUInt32LE(33)).toBe(PERIOD);
    expect(data.subarray(37, 69).equals(commitment)).toBe(true);
    expect(data.readUInt32LE(69)).toBe(8000); // first score
    expect(data.readUInt32LE(89)).toBe(7350); // composite (69 + 20)
    expect(data.readUInt32LE(93)).toBe(uri.length); // borsh string len
    expect(data.length).toBe(93 + 4 + uri.length);
  });

  it('rejects out-of-bounds scores and oversize URI', () => {
    expect(() =>
      encodeSubmitKcsSnapshot({
        tenant,
        period: PERIOD,
        kcsCommitment: Buffer.alloc(32),
        scores: { ...scores, txVolume: 10_001 },
        composite: 7350,
        storageUri: 'x',
      }),
    ).toThrow(/out of bounds/i);
    expect(() =>
      encodeSubmitKcsSnapshot({
        tenant,
        period: PERIOD,
        kcsCommitment: Buffer.alloc(32),
        scores,
        composite: 7350,
        storageUri: 'x'.repeat(201),
      }),
    ).toThrow(/too long/i);
  });
});
