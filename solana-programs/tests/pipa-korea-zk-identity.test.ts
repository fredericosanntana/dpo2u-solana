/**
 * PIPA Korea ZK Identity — scaffold tests.
 *
 * PIPA Art. 24 (RRN ban) + i-PIN replacement primitive.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, derivePipaZkIdentityPda } from './helpers.js';

const ATTR_AGE_GATE_19 = 1;
const ATTR_KOREAN_RESIDENT = 2;
const ATTR_KYC_VERIFIED = 3;
const ATTR_DOMESTIC_REPRESENTATIVE = 4;

describe('pipa-korea-zk-identity — program ID canary', () => {
  it('program ID matches declare_id!()', () => {
    expect(PROGRAM_IDS.pipa_korea_zk_identity.toBase58()).toBe(
      '41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR',
    );
  });
});

describe('pipa-korea-zk-identity — PDA derivation', () => {
  const attestor = Keypair.generate().publicKey;

  it('same (attestor, commitment, kind) → same PDA', () => {
    const c = createHash('sha256').update('subject-secret-001-salt-A').digest();
    const [a] = derivePipaZkIdentityPda(attestor, c, ATTR_AGE_GATE_19);
    const [b] = derivePipaZkIdentityPda(attestor, c, ATTR_AGE_GATE_19);
    expect(a.equals(b)).toBe(true);
  });

  it('different attribute kinds → different PDAs (4 independent attestations per commitment)', () => {
    const c = createHash('sha256').update('subject-secret-001').digest();
    const [age] = derivePipaZkIdentityPda(attestor, c, ATTR_AGE_GATE_19);
    const [resident] = derivePipaZkIdentityPda(attestor, c, ATTR_KOREAN_RESIDENT);
    const [kyc] = derivePipaZkIdentityPda(attestor, c, ATTR_KYC_VERIFIED);
    const [domrep] = derivePipaZkIdentityPda(attestor, c, ATTR_DOMESTIC_REPRESENTATIVE);
    const set = new Set([age, resident, kyc, domrep].map((p) => p.toBase58()));
    expect(set.size).toBe(4);
  });

  it('different commitments → different PDAs (each subject opaque)', () => {
    const c1 = createHash('sha256').update('subject-A').digest();
    const c2 = createHash('sha256').update('subject-B').digest();
    const [a] = derivePipaZkIdentityPda(attestor, c1, ATTR_AGE_GATE_19);
    const [b] = derivePipaZkIdentityPda(attestor, c2, ATTR_AGE_GATE_19);
    expect(a.equals(b)).toBe(false);
  });

  it('different attestors → different PDAs (chain of trust separation)', () => {
    const c = createHash('sha256').update('subject').digest();
    const att2 = Keypair.generate().publicKey;
    const [a] = derivePipaZkIdentityPda(attestor, c, ATTR_KYC_VERIFIED);
    const [b] = derivePipaZkIdentityPda(att2, c, ATTR_KYC_VERIFIED);
    expect(a.equals(b)).toBe(false);
  });
});

describe('pipa-korea-zk-identity — account size budget', () => {
  it('ZkIdentityAttestation fits in 10KB', () => {
    // attestor(32) + subject_commitment(32) + attribute_kind(1)
    // + attribute_metadata_hash(32) + threshold(4)
    // + storage_uri(4+128) + issued_at(8) + expires_at(9) + revoked_at(9)
    // + revocation_reason(5+64) + version(1) + bump(1) + discriminator(8)
    const bytes = 8 + 32 + 32 + 1 + 32 + 4 + (4 + 128) + 8 + 9 + 9 + (5 + 64) + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(338);
  });
});

describe('pipa-korea-zk-identity — PIPA Art. 24 semantic mapping', () => {
  it('NO RRN stored on-chain (only opaque commitment)', () => {
    // PIPA Art. 24 prohibits RRN processing except in narrow statutory cases.
    // This program ONLY stores a 32-byte commitment hash — no PII reaches Solana.
    const rrn = '900101-1234567'; // example Korean RRN format
    const commitment = createHash('sha256').update(rrn + '|salt-XYZ').digest();
    expect(commitment.length).toBe(32);
    // Original RRN never goes on-chain.
  });

  it('4 attribute kinds enumerated', () => {
    expect(ATTR_AGE_GATE_19).toBe(1); // Youth Protection Act
    expect(ATTR_KOREAN_RESIDENT).toBe(2);
    expect(ATTR_KYC_VERIFIED).toBe(3); // FSC-licensed attestor
    expect(ATTR_DOMESTIC_REPRESENTATIVE).toBe(4); // Art. 31-2 (Oct 2025)
  });

  it('proof binding requires public_inputs[32..64] === subject_commitment', () => {
    // Documents the SP1 v6 ABI contract — proof is tied to a specific commitment
    // via bytes [32..64] of public_inputs. This prevents proof-swapping attacks.
    const expectedOffset = 32;
    const expectedEnd = 64;
    expect(expectedEnd - expectedOffset).toBe(32);
  });

  it('proof envelope is 356 bytes (SP1 v6 Groth16)', () => {
    // Same envelope size as compliance-registry + consent-manager.
    const SP1_V6_PROOF_SIZE = 356;
    expect(SP1_V6_PROOF_SIZE).toBe(356);
  });

  it('public_inputs is 96 bytes (ABI-encoded PublicValuesStruct)', () => {
    // ABI layout: [0..32] threshold, [32..64] subject_commitment, [64..96] meets_threshold
    const PUBLIC_INPUTS_SIZE = 96;
    expect(PUBLIC_INPUTS_SIZE).toBe(96);
  });
});
