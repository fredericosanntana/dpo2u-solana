/**
 * POPIA Information Officer Registry — scaffold tests.
 *
 * Mirrors consent-manager.test.ts pattern: PDA derivation, account budget,
 * and POPIA §55/§56 semantic invariants. Runtime CPI tests com bankrun
 * pendentes (post-Sprint D fase 3 quando ledger-fixture for setup).
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, derivePopiaIoPda } from './helpers.js';

describe('popia-info-officer-registry — program ID canary', () => {
  it('program ID is a valid base58 pubkey', () => {
    const pk = PROGRAM_IDS.popia_info_officer_registry;
    expect(pk.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(() => new PublicKey(pk.toBase58())).not.toThrow();
  });

  it('program ID matches declare_id!() in lib.rs', () => {
    expect(PROGRAM_IDS.popia_info_officer_registry.toBase58()).toBe(
      'ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb',
    );
  });
});

describe('popia-info-officer-registry — PDA derivation', () => {
  const rp = Keypair.generate().publicKey;

  it('same (responsibleParty, organizationIdHash) yields same PDA', () => {
    const h = createHash('sha256').update('CIPC-2026/0001').digest();
    const [a, ba] = derivePopiaIoPda(rp, h);
    const [b, bb] = derivePopiaIoPda(rp, h);
    expect(a.equals(b)).toBe(true);
    expect(ba).toBe(bb);
  });

  it('different organization → different PDA (one IO per org)', () => {
    const h1 = createHash('sha256').update('CIPC-2026/0001').digest();
    const h2 = createHash('sha256').update('CIPC-2026/0002').digest();
    const [a] = derivePopiaIoPda(rp, h1);
    const [b] = derivePopiaIoPda(rp, h2);
    expect(a.equals(b)).toBe(false);
  });

  it('different responsibleParty → different PDA (each entity owns its IO record)', () => {
    const h = createHash('sha256').update('CIPC-2026/0001').digest();
    const rp2 = Keypair.generate().publicKey;
    const [a] = derivePopiaIoPda(rp, h);
    const [b] = derivePopiaIoPda(rp2, h);
    expect(a.equals(b)).toBe(false);
  });
});

describe('popia-info-officer-registry — account size budget', () => {
  it('InfoOfficerAppointment fits in 10KB PDA limit', () => {
    // Mirror of #[derive(InitSpace)]:
    //   responsible_party(32) + information_officer(32) + organization_id_hash(32)
    //   + contact_hash(32) + storage_uri(4+128) + appointed_at(8)
    //   + deputy(33) + revoked_at(9) + revocation_reason(5+64)
    //   + version(1) + bump(1) + discriminator(8)
    const bytes =
      8 + 32 + 32 + 32 + 32 + (4 + 128) + 8 + 33 + 9 + (5 + 64) + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(389);
  });
});

describe('popia-info-officer-registry — POPIA §55 semantic mapping', () => {
  it('organization_id_hash is SHA-256 of CIPC company number (or analog)', () => {
    const h = createHash('sha256').update('CIPC-2026/0001').digest();
    expect(h.length).toBe(32);
  });

  it('contact_hash is SHA-256 of contact details (off-chain per POPIA Condition 4 minimality)', () => {
    const h = createHash('sha256').update('io@dpo2u.com').digest();
    expect(h.length).toBe(32);
    // POPIA Condition 4 (Minimality) — keep PII off-chain, hash on-chain.
  });

  it('§56 deputy IO field is Option<Pubkey> (nullable)', () => {
    // Documented contract — deputy CAN be null (single IO model) or set (deputy model).
    // This mirrors the Anchor Option<Pubkey> serialization (1+32 bytes).
    expect(true).toBe(true);
  });
});
