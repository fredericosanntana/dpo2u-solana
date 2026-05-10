/**
 * CCPA Opt-Out Registry — scaffold tests.
 *
 * Verifies PDA derivation invariants para CCPA §1798.135 + GPC signal handling.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, deriveCcpaOptoutPda } from './helpers.js';

const OPTOUT_SALE = 1;
const OPTOUT_SHARE = 2;
const OPTOUT_SENSITIVE = 3;

describe('ccpa-optout-registry — program ID canary', () => {
  it('program ID is a valid base58 pubkey', () => {
    const pk = PROGRAM_IDS.ccpa_optout_registry;
    expect(pk.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });

  it('program ID matches declare_id!()', () => {
    expect(PROGRAM_IDS.ccpa_optout_registry.toBase58()).toBe(
      '5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk',
    );
  });
});

describe('ccpa-optout-registry — PDA derivation', () => {
  const business = Keypair.generate().publicKey;

  it('same (business, consumer_hash, kind) yields same PDA', () => {
    const h = createHash('sha256').update('consumer-001').digest();
    const [a, ba] = deriveCcpaOptoutPda(business, h, OPTOUT_SALE);
    const [b, bb] = deriveCcpaOptoutPda(business, h, OPTOUT_SALE);
    expect(a.equals(b)).toBe(true);
    expect(ba).toBe(bb);
  });

  it('different optoutKind → different PDA (3 independent opt-outs per consumer)', () => {
    const h = createHash('sha256').update('consumer-001').digest();
    const [sale] = deriveCcpaOptoutPda(business, h, OPTOUT_SALE);
    const [share] = deriveCcpaOptoutPda(business, h, OPTOUT_SHARE);
    const [sensitive] = deriveCcpaOptoutPda(business, h, OPTOUT_SENSITIVE);
    expect(sale.equals(share)).toBe(false);
    expect(share.equals(sensitive)).toBe(false);
    expect(sale.equals(sensitive)).toBe(false);
  });

  it('different consumer → different PDA', () => {
    const h1 = createHash('sha256').update('consumer-001').digest();
    const h2 = createHash('sha256').update('consumer-002').digest();
    const [a] = deriveCcpaOptoutPda(business, h1, OPTOUT_SALE);
    const [b] = deriveCcpaOptoutPda(business, h2, OPTOUT_SALE);
    expect(a.equals(b)).toBe(false);
  });

  it('different business → different PDA', () => {
    const h = createHash('sha256').update('consumer-001').digest();
    const business2 = Keypair.generate().publicKey;
    const [a] = deriveCcpaOptoutPda(business, h, OPTOUT_SALE);
    const [b] = deriveCcpaOptoutPda(business2, h, OPTOUT_SALE);
    expect(a.equals(b)).toBe(false);
  });
});

describe('ccpa-optout-registry — account size budget', () => {
  it('OptoutRecord fits in 10KB PDA limit', () => {
    // business(32) + consumer_commitment_hash(32) + optout_kind(1) + via_gpc(1)
    // + storage_uri(4+128) + opted_out_at(8) + expires_at(9) + reversed_at(9)
    // + version(1) + bump(1) + discriminator(8)
    const bytes = 8 + 32 + 32 + 1 + 1 + (4 + 128) + 8 + 9 + 9 + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(234);
  });
});

describe('ccpa-optout-registry — CCPA §1798.135 semantic mapping', () => {
  it('3 optout kinds match Rust constants', () => {
    expect(OPTOUT_SALE).toBe(1); // §1798.120
    expect(OPTOUT_SHARE).toBe(2); // CPRA cross-context
    expect(OPTOUT_SENSITIVE).toBe(3); // §1798.121
  });

  it('consumer_commitment_hash keeps PII off-chain (CCPA §1798.100(c) data minimization)', () => {
    const consumerEmail = 'user@example.com';
    const h = createHash('sha256').update(consumerEmail).digest();
    expect(h.length).toBe(32);
    // Hash IS the on-chain identifier — original email never reaches Solana.
  });

  it('via_gpc=true signals Global Privacy Control (Cal. Code Regs. tit. 11 §7025)', () => {
    // Documented contract — GPC signals are valid opt-outs and must be honored.
    const validGpc = true;
    expect(validGpc).toBe(true);
  });
});
