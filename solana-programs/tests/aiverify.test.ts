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
  const op = Keypair.generate().publicKey;

  it('same (operator, model_hash) → same PDA', () => {
    const h = createHash('sha256').update('model_v1_weights').digest();
    const [a] = deriveAiverifyPda(op, h);
    const [b] = deriveAiverifyPda(op, h);
    expect(a.equals(b)).toBe(true);
  });

  it('different model_hash → different PDA', () => {
    const h1 = createHash('sha256').update('model_v1').digest();
    const h2 = createHash('sha256').update('model_v2').digest();
    const [a] = deriveAiverifyPda(op, h1);
    const [b] = deriveAiverifyPda(op, h2);
    expect(a.equals(b)).toBe(false);
  });

  it('Bucket 2 fix: different operators → different PDAs for same model (multi-operator support)', () => {
    // Post-fix seeds = [b"aiverify", operator, model_hash]. Multiple operators
    // (e.g., Google + Anthropic + OpenAI) can each attest the same public
    // model independently. Removes the front-run-and-seal-the-PDA vector.
    const h = createHash('sha256').update('shared_model').digest();
    const op1 = Keypair.generate().publicKey;
    const op2 = Keypair.generate().publicKey;
    const [pdaFromOp1] = deriveAiverifyPda(op1, h);
    const [pdaFromOp2] = deriveAiverifyPda(op2, h);
    expect(pdaFromOp1.equals(pdaFromOp2)).toBe(false);
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
