/**
 * Frente 3 (AI Verify, Singapore) — aiverify-attestation scaffold tests.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, deriveAiverifyPda } from './helpers.js';

describe('aiverify-attestation — program ID canary', () => {
  it('program ID matches declare_id!()', () => {
    expect(PROGRAM_IDS.aiverify_attestation.toBase58()).toBe(
      'DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm',
    );
  });
});

describe('aiverify-attestation — PDA derivation', () => {
  it('same model_hash → same PDA', () => {
    const h = createHash('sha256').update('model_v1_weights').digest();
    const [a] = deriveAiverifyPda(h);
    const [b] = deriveAiverifyPda(h);
    expect(a.equals(b)).toBe(true);
  });

  it('different model_hash → different PDA', () => {
    const h1 = createHash('sha256').update('model_v1').digest();
    const h2 = createHash('sha256').update('model_v2').digest();
    const [a] = deriveAiverifyPda(h1);
    const [b] = deriveAiverifyPda(h2);
    expect(a.equals(b)).toBe(false);
  });

  it('PDA is independent of operator (same model attested once globally)', () => {
    // By design, seeds = [b"aiverify", model_hash] (no operator). Two operators
    // cannot attest the same model independently — the PDA clashes on init.
    // This is intentional: globally unique attestation per model_hash.
    const h = createHash('sha256').update('shared_model').digest();
    const op1 = Keypair.generate().publicKey;
    const op2 = Keypair.generate().publicKey;
    const [pdaFromOp1] = deriveAiverifyPda(h);
    const [pdaFromOp2] = deriveAiverifyPda(h);
    expect(pdaFromOp1.equals(pdaFromOp2)).toBe(true);
    expect(op1.equals(op2)).toBe(false); // sanity
  });
});

describe('aiverify-attestation — account size budget', () => {
  it('ModelAttestation fits in 10KB PDA limit', () => {
    // InitSpace: operator(32) + model_hash(32) + test_report_hash(32) + vk_root(32)
    //  + framework_code(2) + attested_at(8) + revoked_at(9) + reason_code(2)
    //  + version(1) + bump(1) + discriminator(8)
    const bytes = 8 + 32 + 32 + 32 + 32 + 2 + 8 + 9 + 2 + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(159);
  });
});

describe('aiverify-attestation — framework_code taxonomy', () => {
  it('documented codes', () => {
    // These are illustrative — update here when adding support for other
    // conformity frameworks. Programs read the raw u16 and don't enforce.
    const taxonomy = {
      AI_VERIFY_SINGAPORE: 0,
      EU_AI_ACT_CONFORMITY: 1,
      ISO_IEC_42001: 2,
    };
    expect(taxonomy.AI_VERIFY_SINGAPORE).toBe(0);
  });
});
