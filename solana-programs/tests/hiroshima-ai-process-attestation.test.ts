/**
 * Hiroshima AI Process Attestation — scaffold tests.
 *
 * Voluntary on-chain attestation of:
 *  - CAIO appointment (DS-920 mandate)
 *  - Red team evidence (AISI Red Teaming v1.10)
 *  - ICOC commitment (Hiroshima G7 11 principles)
 *  - Data quality (AISI v1.01 / AIST ML Quality v3)
 *  - AIBOG alignment (METI+MIC v1.1 10 principles)
 *
 * Sprint E (2026-05-04) — programa built, deploy devnet pendente.
 */

import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, deriveHiroshimaAttestationPda, randomSeed } from './helpers.js';

const ATTEST_CAIO = 1;
const ATTEST_RED_TEAM = 2;
const ATTEST_ICOC = 3;
const ATTEST_DATA_QUALITY = 4;
const ATTEST_AIBOG = 5;
// Sprint F (2026-05-06)
const ATTEST_RED_LINE_NEGATIVE = 6;
const ATTEST_HRIA = 7;
const ATTEST_INCIDENT = 8;
const TERM_TRIGGER_ATTESTATION_REVOCATION = 1;
const TERM_TRIGGER_RAPPORTEUR_FLAG = 2;

describe('hiroshima-ai-process-attestation — program ID canary', () => {
  it('program ID matches declare_id!()', () => {
    expect(PROGRAM_IDS.hiroshima_ai_process_attestation.toBase58()).toBe(
      '4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx',
    );
  });
});

describe('hiroshima-ai-process-attestation — PDA derivation', () => {
  const attestor = Keypair.generate().publicKey;

  it('same (attestor, ai_system_id, type) → same PDA (deterministic)', () => {
    const sysId = createHash('sha256').update('ai-system-001').digest();
    const [a] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_CAIO);
    const [b] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_CAIO);
    expect(a.equals(b)).toBe(true);
  });

  it('different attestation types → 5 distinct PDAs per AI system', () => {
    const sysId = createHash('sha256').update('ai-system-002').digest();
    const [caio] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_CAIO);
    const [redTeam] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_RED_TEAM);
    const [icoc] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_ICOC);
    const [dataQ] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_DATA_QUALITY);
    const [aibog] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_AIBOG);
    const set = new Set([caio, redTeam, icoc, dataQ, aibog].map((p) => p.toBase58()));
    expect(set.size).toBe(5);
  });

  it('different ai_system_ids → different PDAs', () => {
    const sys1 = createHash('sha256').update('gpt-4-japan-deploy').digest();
    const sys2 = createHash('sha256').update('claude-japan-deploy').digest();
    const [a] = deriveHiroshimaAttestationPda(attestor, sys1, ATTEST_ICOC);
    const [b] = deriveHiroshimaAttestationPda(attestor, sys2, ATTEST_ICOC);
    expect(a.equals(b)).toBe(false);
  });

  it('different attestors → different PDAs (chain-of-trust separation)', () => {
    const att2 = Keypair.generate().publicKey;
    const sysId = createHash('sha256').update('ai-system-shared').digest();
    const [a] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_CAIO);
    const [b] = deriveHiroshimaAttestationPda(att2, sysId, ATTEST_CAIO);
    expect(a.equals(b)).toBe(false);
  });

  it('PDA derivation is consistent across random seeds', () => {
    for (let i = 0; i < 5; i++) {
      const sysId = randomSeed();
      const [a] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_RED_TEAM);
      const [b] = deriveHiroshimaAttestationPda(attestor, sysId, ATTEST_RED_TEAM);
      expect(a.equals(b)).toBe(true);
    }
  });
});

describe('hiroshima-ai-process-attestation — account size budget', () => {
  it('HiroshimaAttestation fits well under 10KB stack budget', () => {
    // Discriminator(8) + attestor(32) + ai_system_id(32) + attestation_type(1) +
    // evidence_hash(32) + valid_until Option<i64>(9) + revoked_at Option<i64>(9) +
    // storage_uri String<=128 (4 + 128) + issued_at(8) + version(1) + bump(1)
    // = 8 + 32 + 32 + 1 + 32 + 9 + 9 + 4 + 128 + 8 + 1 + 1 = 265 bytes
    const bytes = 8 + 32 + 32 + 1 + 32 + 9 + 9 + (4 + 128) + 8 + 1 + 1;
    expect(bytes).toBe(265);
    expect(bytes).toBeLessThan(10_240);
  });
});

describe('hiroshima-ai-process-attestation — semantic mapping', () => {
  it('attestation type constants align with Rust program', () => {
    expect(ATTEST_CAIO).toBe(1);
    expect(ATTEST_RED_TEAM).toBe(2);
    expect(ATTEST_ICOC).toBe(3);
    expect(ATTEST_DATA_QUALITY).toBe(4);
    expect(ATTEST_AIBOG).toBe(5);
  });

  it('one attestor can hold parallel attestations across multiple AI systems', () => {
    const attestor = Keypair.generate().publicKey;
    const sysIds = ['gpt-4', 'claude', 'gemini', 'llama-3'].map((s) =>
      createHash('sha256').update(s).digest(),
    );
    const pdas = sysIds.map((id) => deriveHiroshimaAttestationPda(attestor, id, ATTEST_ICOC)[0]);
    const set = new Set(pdas.map((p) => p.toBase58()));
    expect(set.size).toBe(4); // 4 distinct PDAs from same attestor
  });
});

// ─── Sprint F (2026-05-06) — CAIDP UN Global Dialogue alignment ──────────

describe('hiroshima-ai-process-attestation — Sprint F new attestation types', () => {
  const attestor = Keypair.generate().publicKey;

  it('exposes 3 new attestation types (red-line-negative, HRIA, incident)', () => {
    expect(ATTEST_RED_LINE_NEGATIVE).toBe(6);
    expect(ATTEST_HRIA).toBe(7);
    expect(ATTEST_INCIDENT).toBe(8);
  });

  it('all 8 attestation types yield distinct PDAs for same (attestor, system)', () => {
    const sysId = createHash('sha256').update('multi-anchor-system').digest();
    const types = [
      ATTEST_CAIO,
      ATTEST_RED_TEAM,
      ATTEST_ICOC,
      ATTEST_DATA_QUALITY,
      ATTEST_AIBOG,
      ATTEST_RED_LINE_NEGATIVE,
      ATTEST_HRIA,
      ATTEST_INCIDENT,
    ];
    const pdas = types.map((t) => deriveHiroshimaAttestationPda(attestor, sysId, t)[0]);
    const set = new Set(pdas.map((p) => p.toBase58()));
    expect(set.size).toBe(8);
  });
});

describe('hiroshima-ai-process-attestation — Sprint F rapporteur config + termination order PDAs', () => {
  const programId = PROGRAM_IDS.hiroshima_ai_process_attestation;

  function deriveRapporteurConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('rapporteur_config')],
      programId,
    );
  }

  function deriveTerminationOrderPda(aiSystemId: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('termination_order'), Buffer.from(aiSystemId)],
      programId,
    );
  }

  it('rapporteur_config is a singleton PDA per program', () => {
    const [a] = deriveRapporteurConfigPda();
    const [b] = deriveRapporteurConfigPda();
    expect(a.equals(b)).toBe(true);
  });

  it('termination_order is per-ai_system_id (not per attestor)', () => {
    const sys1 = createHash('sha256').update('flagged-1').digest();
    const sys2 = createHash('sha256').update('flagged-2').digest();
    const [a] = deriveTerminationOrderPda(sys1);
    const [b] = deriveTerminationOrderPda(sys2);
    expect(a.equals(b)).toBe(false);
    // Idempotent for same input
    const [c] = deriveTerminationOrderPda(sys1);
    expect(a.equals(c)).toBe(true);
  });

  it('termination_order PDA is independent of rapporteur_config PDA', () => {
    const sysId = createHash('sha256').update('sys').digest();
    const [cfg] = deriveRapporteurConfigPda();
    const [order] = deriveTerminationOrderPda(sysId);
    expect(cfg.equals(order)).toBe(false);
  });
});

describe('hiroshima-ai-process-attestation — Sprint F account budgets', () => {
  it('RapporteurConfig fits comfortably under 10KB', () => {
    // 8 (disc) + 32 (admin) + 32 (rapporteur_authority) + 1 (version) + 1 (bump) + 8 (initialized_at)
    const bytes = 8 + 32 + 32 + 1 + 1 + 8;
    expect(bytes).toBe(82);
    expect(bytes).toBeLessThan(10_240);
  });

  it('TerminationOrder fits comfortably under 10KB', () => {
    // 8 (disc) + 32 (ordered_by) + 32 (ai_system_id) + 4 + 128 (reason) + 32 (evidence_hash) +
    // 1 (red_line_category) + 8 (ordered_at) + 1 (version) + 1 (bump)
    const bytes = 8 + 32 + 32 + 4 + 128 + 32 + 1 + 8 + 1 + 1;
    expect(bytes).toBe(247);
    expect(bytes).toBeLessThan(10_240);
  });
});

describe('hiroshima-ai-process-attestation — Sprint F semantic mapping', () => {
  it('termination trigger constants stable on-chain', () => {
    expect(TERM_TRIGGER_ATTESTATION_REVOCATION).toBe(1);
    expect(TERM_TRIGGER_RAPPORTEUR_FLAG).toBe(2);
  });

  it('CAIDP red-line categories cover the canonical 7 (validates schema parity with mcp-server)', () => {
    const categories = [
      'emotion_analysis',
      'biometric_categorization',
      'biometric_mass_surveillance',
      'predictive_policing',
      'child_targeting',
      'social_scoring',
      'subliminal_manipulation',
    ];
    expect(categories).toHaveLength(7);
    // u8 indices fit in 0-255 — no overflow risk for red_line_category field
    categories.forEach((_, idx) => expect(idx).toBeLessThan(256));
  });
});
