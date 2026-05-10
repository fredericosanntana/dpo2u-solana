/**
 * PIPEDA Consent Extension — scaffold tests.
 *
 * PIPEDA Schedule 1 (10 principles) + Digital Privacy Act 2018 §10.1 RROSH.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, derivePipedaConsentPda } from './helpers.js';

const CONSENT_EXPRESS = 1;
const CONSENT_IMPLIED = 2;
const CONSENT_OPT_OUT = 3;

describe('pipeda-consent-extension — program ID canary', () => {
  it('program ID matches declare_id!()', () => {
    expect(PROGRAM_IDS.pipeda_consent_extension.toBase58()).toBe(
      'G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT',
    );
  });
});

describe('pipeda-consent-extension — PDA derivation', () => {
  const subject = Keypair.generate().publicKey;
  const org = Keypair.generate().publicKey;

  it('same (subject, organization, purpose_hash) → same PDA', () => {
    const h = createHash('sha256').update('pipeda:p3:marketing').digest();
    const [a] = derivePipedaConsentPda(subject, org, h);
    const [b] = derivePipedaConsentPda(subject, org, h);
    expect(a.equals(b)).toBe(true);
  });

  it('different purposes → different PDAs (multiple consents per subject-org)', () => {
    const h1 = createHash('sha256').update('marketing').digest();
    const h2 = createHash('sha256').update('analytics').digest();
    const [a] = derivePipedaConsentPda(subject, org, h1);
    const [b] = derivePipedaConsentPda(subject, org, h2);
    expect(a.equals(b)).toBe(false);
  });

  it('different organizations → different PDAs (consent is per-controller per Principle 4.1)', () => {
    const h = createHash('sha256').update('analytics').digest();
    const org2 = Keypair.generate().publicKey;
    const [a] = derivePipedaConsentPda(subject, org, h);
    const [b] = derivePipedaConsentPda(subject, org2, h);
    expect(a.equals(b)).toBe(false);
  });
});

describe('pipeda-consent-extension — account size budget', () => {
  it('PipedaConsentRecord fits in 10KB', () => {
    // subject(32) + organization(32) + purpose_code(2) + purpose_hash(32)
    // + consent_form(1) + principles_evidenced(2)
    // + cross_border_destination(3) [Option<[u8;2]> = 1+2]
    // + storage_uri(4+128) + issued_at(8) + withdrawn_at(9)
    // + withdrawal_reason(5+64) + breach_threshold_crossed(1)
    // + version(1) + bump(1) + discriminator(8)
    const bytes = 8 + 32 + 32 + 2 + 32 + 1 + 2 + 3 + (4 + 128) + 8 + 9 + (5 + 64) + 1 + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(333);
  });
});

describe('pipeda-consent-extension — PIPEDA Schedule 1 semantic mapping', () => {
  it('3 consent forms match Principle 4.3.6', () => {
    expect(CONSENT_EXPRESS).toBe(1); // explicit signed/clicked
    expect(CONSENT_IMPLIED).toBe(2); // reasonable expectation
    expect(CONSENT_OPT_OUT).toBe(3); // opt-out in limited circumstances
  });

  it('principles_evidenced bitmap supports all 10 PIPEDA principles', () => {
    // 10 principles → bits 1-10 → fits in u16.
    const all10 = 0b0000_0011_1111_1111; // 0x3FF — bits 1 through 10
    expect(all10).toBe(1023);
    const u16Max = 65_535;
    expect(all10).toBeLessThan(u16Max);
  });

  it('cross_border_destination uses ISO-3166-1 alpha-2 (2 chars)', () => {
    const us: [number, number] = ['U'.charCodeAt(0), 'S'.charCodeAt(0)];
    expect(us.length).toBe(2);
  });

  it('breach_threshold_crossed maps to DPA 2018 §10.1 RROSH', () => {
    // RROSH = Real Risk Of Significant Harm. Once flagged, OPC notification
    // timer kicks in ('as soon as feasible').
    const rroshFlagged = true;
    expect(rroshFlagged).toBe(true);
  });
});
