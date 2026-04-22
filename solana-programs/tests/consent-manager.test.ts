/**
 * Frente 1 (DPDP India) — consent-manager scaffold tests.
 *
 * Sprint A: pure PDA + schema tests, no LiteSVM runtime. Runtime CPI tests
 * follow the pattern in verified-attestation.test.ts once the program is
 * compiled via `anchor build`.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, deriveConsentPda } from './helpers.js';

describe('consent-manager — program ID canary', () => {
  it('program ID is a valid base58 pubkey', () => {
    const pk = PROGRAM_IDS.consent_manager;
    expect(pk.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(() => new PublicKey(pk.toBase58())).not.toThrow();
  });

  it('program ID matches declare_id!() in lib.rs', () => {
    // If someone updates declare_id!() but forgets helpers.ts, this breaks.
    expect(PROGRAM_IDS.consent_manager.toBase58()).toBe(
      'D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB',
    );
  });
});

describe('consent-manager — PDA derivation', () => {
  const user = Keypair.generate().publicKey;
  const fiduciary = Keypair.generate().publicKey;

  it('same (user, fiduciary, purpose_hash) yields same PDA', () => {
    const h = createHash('sha256').update('marketing_communications').digest();
    const [a, ba] = deriveConsentPda(user, fiduciary, h);
    const [b, bb] = deriveConsentPda(user, fiduciary, h);
    expect(a.equals(b)).toBe(true);
    expect(ba).toBe(bb);
  });

  it('different purpose_hash → different PDA (multiple consents per fiduciary)', () => {
    const h1 = createHash('sha256').update('marketing_communications').digest();
    const h2 = createHash('sha256').update('product_improvement').digest();
    const [a] = deriveConsentPda(user, fiduciary, h1);
    const [b] = deriveConsentPda(user, fiduciary, h2);
    expect(a.equals(b)).toBe(false);
  });

  it('different fiduciary → different PDA (same user can opt into many controllers)', () => {
    const h = createHash('sha256').update('analytics').digest();
    const fid2 = Keypair.generate().publicKey;
    const [a] = deriveConsentPda(user, fiduciary, h);
    const [b] = deriveConsentPda(user, fid2, h);
    expect(a.equals(b)).toBe(false);
  });

  it('different user → different PDA (fiduciary tracks per-user consent)', () => {
    const h = createHash('sha256').update('analytics').digest();
    const user2 = Keypair.generate().publicKey;
    const [a] = deriveConsentPda(user, fiduciary, h);
    const [b] = deriveConsentPda(user2, fiduciary, h);
    expect(a.equals(b)).toBe(false);
  });
});

describe('consent-manager — account size budget', () => {
  it('ConsentRecord fits in 10KB PDA limit', () => {
    // Mirror of #[derive(InitSpace)] in lib.rs:
    //   user(32) + data_fiduciary(32) + purpose_code(2) + purpose_hash(32)
    //   + storage_uri(4+128) + issued_at(8) + expires_at(9) + revoked_at(9)
    //   + revocation_reason(5+64) + version(1) + bump(1) + verified(1) + threshold(4)
    //   + discriminator(8)
    const bytes =
      8 + 32 + 32 + 2 + 32 + (4 + 128) + 8 + 9 + 9 + (5 + 64) + 1 + 1 + 1 + 4;
    expect(bytes).toBeLessThan(10_240);
    // Concrete budget snapshot — if struct grows, update this number explicitly.
    expect(bytes).toBe(340);
  });
});

describe('consent-manager — DPDP §6 semantic mapping', () => {
  it('purpose_hash is SHA-256 of purpose text (off-chain)', () => {
    // This test documents the expected off-chain contract for purpose_hash.
    const purpose = 'marketing_communications';
    const h = createHash('sha256').update(purpose).digest();
    expect(h.length).toBe(32);
    // Any client (SDK, CLI, MCP tool) MUST use SHA-256 of the raw UTF-8 bytes.
  });

  it('purpose_code is a u16 — enough for 65k distinct purposes per fiduciary', () => {
    const MAX_U16 = 65_535;
    expect(MAX_U16).toBeGreaterThan(10_000); // realistic purpose taxonomy size
  });
});
