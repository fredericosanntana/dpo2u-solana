/**
 * Pure-helpers smoke tests for DPO2UConsentClient — no network.
 *
 * Mirrors client.test.ts but for the consent-manager program. Verifies PDA
 * derivation + purpose_hash helpers + IDL-based encoding.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

import {
  DPO2UConsentClient,
  CONSENT_MANAGER_PROGRAM_ID,
} from './consent.js';

const fakeSigner = Keypair.generate();

describe('DPO2UConsentClient — pure helpers (no network)', () => {
  it('CONSENT_MANAGER_PROGRAM_ID matches declare_id!()', () => {
    expect(CONSENT_MANAGER_PROGRAM_ID.toBase58()).toBe(
      'D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB',
    );
  });

  it('deriveConsentPda matches the [b"consent", user, fiduciary, purpose_hash] seeds', () => {
    const client = new DPO2UConsentClient({ cluster: 'localnet', signer: fakeSigner });
    const user = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const fiduciary = fakeSigner.publicKey;
    const purposeHash = createHash('sha256').update('marketing_communications').digest();

    const [pda1, bump1] = client.deriveConsentPda(user, fiduciary, new Uint8Array(purposeHash));
    const [pda2, bump2] = client.deriveConsentPda(user, fiduciary, new Uint8Array(purposeHash));

    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);

    const [canonical] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('consent'),
        user.toBuffer(),
        fiduciary.toBuffer(),
        Buffer.from(purposeHash),
      ],
      CONSENT_MANAGER_PROGRAM_ID,
    );
    expect(pda1.equals(canonical)).toBe(true);
  });

  it('purposeHashFromText is sha256 of UTF-8 bytes', () => {
    const text = 'marketing_communications';
    const expected = createHash('sha256').update(text).digest();
    const computed = DPO2UConsentClient.purposeHashFromText(text);
    expect(Buffer.from(computed).equals(expected)).toBe(true);
  });
});

describe('DPO2UConsentClient — recordVerifiedConsent pre-check', () => {
  const client = new DPO2UConsentClient({ cluster: 'localnet', signer: fakeSigner });

  it('rejects proof length != 356', async () => {
    await expect(
      client.recordVerifiedConsent({
        user: Keypair.generate().publicKey,
        purposeCode: 1,
        purposeText: 'x',
        proof: new Uint8Array(100),
        publicInputs: new Uint8Array(96),
      }),
    ).rejects.toThrow(/proof must be 356 bytes/);
  });

  it('rejects publicInputs length != 96', async () => {
    await expect(
      client.recordVerifiedConsent({
        user: Keypair.generate().publicKey,
        purposeCode: 1,
        purposeText: 'x',
        proof: new Uint8Array(356),
        publicInputs: new Uint8Array(50),
      }),
    ).rejects.toThrow(/publicInputs must be 96 bytes/);
  });

  it('rejects mismatched purposeHash vs proof subject_commitment', async () => {
    // Build publicInputs where bytes [32..64] are all 0xAA
    const pi = new Uint8Array(96);
    pi.fill(0xaa, 32, 64);
    // But purposeText hashes to something else
    await expect(
      client.recordVerifiedConsent({
        user: Keypair.generate().publicKey,
        purposeCode: 1,
        purposeText: 'different_purpose',
        proof: new Uint8Array(356),
        publicInputs: pi,
      }),
    ).rejects.toThrow(/subject_commitment inside proof/);
  });
});

describe('DPO2UConsentClient — instruction encoding', () => {
  const client = new DPO2UConsentClient({ cluster: 'localnet', signer: fakeSigner });
  const coder: any = (client as any).coder;

  it('record_consent encodes without throwing', () => {
    const encoded = coder.instruction.encode('record_consent', {
      purpose_code: 42,
      purpose_hash: Array.from(new Uint8Array(32).fill(1)),
      storage_uri: 'ipfs://QmTest',
      expires_at: null,
    });
    expect(encoded.length).toBeGreaterThan(8);
    // First 8 bytes = discriminator
    expect(Array.from(encoded.slice(0, 8))).toEqual([49, 139, 61, 161, 229, 172, 247, 180]);
  });

  it('revoke_consent encodes with correct discriminator', () => {
    const encoded = coder.instruction.encode('revoke_consent', {
      reason: 'user request',
    });
    expect(Array.from(encoded.slice(0, 8))).toEqual([36, 0, 100, 148, 132, 131, 112, 76]);
  });
});
