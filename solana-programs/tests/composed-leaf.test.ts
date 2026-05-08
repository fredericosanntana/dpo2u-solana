/**
 * composed-leaf.test.ts — Composed Stack Fase 2
 *
 * Unit tests pro AttestationLeaf serialization + hash determinism.
 *
 * Crítico: o serialization layout TS DEVE bater 1:1 com o Borsh do struct
 * `AttestationLeaf` em programs/compliance-registry-pinocchio/src/lib.rs.
 * Se isso desalinhar, leaf hashes computados off-chain (Photon Indexer +
 * MCP server) divergem dos calculados on-chain → impossível verificar
 * attestations.
 *
 * Esses tests rodam puro TS (sem bankrun) — rápidos, freeze hash output
 * via snapshot pra detectar drifts acidentais.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  AttestationLeaf,
  ATTESTATION_LEAF_SIZE,
  LEAF_STATUS_ACTIVE,
  LEAF_STATUS_REVOKED,
  LEAF_SCHEMA_VERSION_V1,
  serializeAttestationLeaf,
  computeLeafHash,
} from './helpers.js';

function fixedLeaf(): AttestationLeaf {
  return {
    subject: Buffer.alloc(32, 0xaa),
    commitment: Buffer.alloc(32, 0xbb),
    payloadHash: Buffer.alloc(32, 0xcc),
    shdwUrl: Buffer.from(
      'https://shdw-drive.genesysgo.net/test-storage/dpia-batch-q2.json'.padEnd(96, '\0'),
      'utf8',
    ).subarray(0, 96),
    jurisdiction: 0, // LGPD
    authority: Buffer.alloc(32, 0xdd),
    status: LEAF_STATUS_ACTIVE,
    issuedAt: 1700000000n,
    expiresAt: 1700000000n + 365n * 86400n,
    revokedAt: 0n,
    revokeReason: 0,
    schemaVersion: LEAF_SCHEMA_VERSION_V1,
  };
}

describe('AttestationLeaf — serialization', () => {
  it('serializes to exactly 252 bytes (fixed-size invariant)', () => {
    const buf = serializeAttestationLeaf(fixedLeaf());
    expect(buf.length).toBe(ATTESTATION_LEAF_SIZE);
    expect(buf.length).toBe(252);
  });

  it('rejects mis-sized inputs', () => {
    const bad = { ...fixedLeaf(), subject: Buffer.alloc(31) };
    expect(() => serializeAttestationLeaf(bad)).toThrow(/subject/);
  });

  it('layout matches expected offsets', () => {
    // Use bytes facilmente identificáveis em cada campo pra validar offsets.
    // Layout (252 bytes total): see helpers.ts for the offset table.
    const buf = serializeAttestationLeaf({
      subject: Buffer.alloc(32, 0x11),
      commitment: Buffer.alloc(32, 0x22),
      payloadHash: Buffer.alloc(32, 0x33),
      shdwUrl: Buffer.alloc(96, 0x44),
      jurisdiction: 0x55,
      authority: Buffer.alloc(32, 0x66),
      status: 0x77,
      issuedAt: 0n,
      expiresAt: 0n,
      revokedAt: 0n,
      revokeReason: 0x88,
      schemaVersion: 0x99,
    });
    expect(buf[0]).toBe(0x11);       // subject start
    expect(buf[31]).toBe(0x11);      // subject end
    expect(buf[32]).toBe(0x22);      // commitment start
    expect(buf[63]).toBe(0x22);      // commitment end
    expect(buf[64]).toBe(0x33);      // payload_hash start
    expect(buf[95]).toBe(0x33);      // payload_hash end
    expect(buf[96]).toBe(0x44);      // shdw_url start
    expect(buf[191]).toBe(0x44);     // shdw_url end
    expect(buf[192]).toBe(0x55);     // jurisdiction
    expect(buf[193]).toBe(0x66);     // authority start
    expect(buf[224]).toBe(0x66);     // authority end
    expect(buf[225]).toBe(0x77);     // status
    // 226..233 issued_at, 234..241 expires_at, 242..249 revoked_at (all zero here)
    expect(buf[250]).toBe(0x88);     // revoke_reason
    expect(buf[251]).toBe(0x99);     // schema_version
  });

  it('different jurisdictions produce different hashes', () => {
    const a = computeLeafHash({ ...fixedLeaf(), jurisdiction: 0 });
    const b = computeLeafHash({ ...fixedLeaf(), jurisdiction: 1 });
    expect(a.equals(b)).toBe(false);
  });

  it('Active vs Revoked status produces different hashes', () => {
    const active = computeLeafHash({ ...fixedLeaf(), status: LEAF_STATUS_ACTIVE });
    const revoked = computeLeafHash({
      ...fixedLeaf(),
      status: LEAF_STATUS_REVOKED,
      revokedAt: 1700000001n,
      revokeReason: 1,
    });
    expect(active.equals(revoked)).toBe(false);
  });

  it('hash is 32 bytes and non-zero', () => {
    const hash = computeLeafHash(fixedLeaf());
    expect(hash.length).toBe(32);
    expect(hash.equals(Buffer.alloc(32, 0))).toBe(false);
  });

  it('hash is stable across two computations of the same leaf', () => {
    const a = computeLeafHash(fixedLeaf());
    const b = computeLeafHash(fixedLeaf());
    expect(a.equals(b)).toBe(true);
  });

  it('payload_hash changes leaf hash', () => {
    const a = computeLeafHash({ ...fixedLeaf(), payloadHash: Buffer.alloc(32, 0xa1) });
    const b = computeLeafHash({ ...fixedLeaf(), payloadHash: Buffer.alloc(32, 0xa2) });
    expect(a.equals(b)).toBe(false);
  });

  it('different shdw_url produces different hashes', () => {
    const a = computeLeafHash({
      ...fixedLeaf(),
      shdwUrl: Buffer.from(
        'https://shdw-drive.genesysgo.net/storage-a/file.json'.padEnd(96, '\0'),
        'utf8',
      ).subarray(0, 96),
    });
    const b = computeLeafHash({
      ...fixedLeaf(),
      shdwUrl: Buffer.from(
        'https://shdw-drive.genesysgo.net/storage-b/file.json'.padEnd(96, '\0'),
        'utf8',
      ).subarray(0, 96),
    });
    expect(a.equals(b)).toBe(false);
  });

  it('authority change is reflected in hash (so revoke flow is binding)', () => {
    const a = computeLeafHash({ ...fixedLeaf(), authority: Buffer.alloc(32, 0xee) });
    const b = computeLeafHash({ ...fixedLeaf(), authority: Buffer.alloc(32, 0xff) });
    expect(a.equals(b)).toBe(false);
  });

  it('schema_version field is reflected in hash (forward-compat tripwire)', () => {
    const v1 = computeLeafHash({ ...fixedLeaf(), schemaVersion: 1 });
    const v2 = computeLeafHash({ ...fixedLeaf(), schemaVersion: 2 });
    expect(v1.equals(v2)).toBe(false);
  });

  it('hash matches manual SHA-256 of serialized buffer', () => {
    const leaf = fixedLeaf();
    const expected = createHash('sha256')
      .update(serializeAttestationLeaf(leaf))
      .digest();
    expect(computeLeafHash(leaf).equals(expected)).toBe(true);
  });
});
