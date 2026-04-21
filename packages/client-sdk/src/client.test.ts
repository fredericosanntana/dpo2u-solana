/**
 * Lightweight smoke tests — no network. Focus: prove the PDA derivation in
 * DPO2UClient matches the canonical helper (same seed order, same program
 * id, same bump) so that clients consuming this SDK land on the exact same
 * Attestation PDA as the solana-programs test suite and the on-chain program.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

import { DPO2UClient, PROGRAM_IDS, VERIFIER_PROGRAM_ID } from './client.js';

// Minimal fake keypair — tests don't need a real RPC.
const fakeSigner = Keypair.generate();

describe('DPO2UClient — pure helpers (no network)', () => {
  it('PROGRAM_IDS table matches the declare_id!() in each on-chain program', () => {
    // If any of these drift, the CI integration test would fail anyway,
    // but this catches the drift at the SDK layer first with a clearer error.
    expect(PROGRAM_IDS.compliance_registry.toBase58()).toBe(
      'FrvXc4bqCG3268LVaLR3nwogWmDsVwnSqRE6M1dcdJc3',
    );
    expect(PROGRAM_IDS.agent_registry.toBase58()).toBe(
      'd8NoVV3Xz9PU9AoTA1SokMJjwY55kN7CEbVjhySGYym',
    );
    expect(PROGRAM_IDS.payment_gateway.toBase58()).toBe(
      'CbAYe2hsBZmrB4GB8VcLZDchUuDonoG15Cg6n9cnE7Cn',
    );
    expect(PROGRAM_IDS.fee_distributor.toBase58()).toBe(
      '9M88ZwVVrY5HF3T1XhuN1Hwen9YX7885c3TMed7u9zRd',
    );
    expect(PROGRAM_IDS.agent_wallet_factory.toBase58()).toBe(
      'BsJ6xWhvEhvJTsGNSiXHgJidysM92fLkAY38D48WAV1f',
    );
    expect(VERIFIER_PROGRAM_ID.toBase58()).toBe(
      '9mM8YFGjVQNqdVHfidfhFd76nBnC1Cbj5bxi17AwQFuB',
    );
  });

  it('deriveAttestationPda is deterministic and matches the [b"attestation", subject, commitment] seed pattern', () => {
    const client = new DPO2UClient({ cluster: 'localnet', signer: fakeSigner });
    const subject = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const commitment = createHash('sha256').update('did:test:company:acme').digest();

    const [pda1, bump1] = client.deriveAttestationPda(subject, new Uint8Array(commitment));
    const [pda2, bump2] = client.deriveAttestationPda(subject, new Uint8Array(commitment));

    expect(pda1.equals(pda2)).toBe(true);
    expect(bump1).toBe(bump2);

    // Cross-check against PublicKey.findProgramAddressSync directly — if the
    // SDK ever deviates from the canonical seed pattern, this fails.
    const [canonical] = PublicKey.findProgramAddressSync(
      [Buffer.from('attestation'), subject.toBuffer(), Buffer.from(commitment)],
      PROGRAM_IDS.compliance_registry,
    );
    expect(pda1.equals(canonical)).toBe(true);
  });

  it('commitmentFromSubject matches the fixture proof commitment for "did:test:company:acme"', () => {
    // Sprint 4c proof was generated with subject "did:test:company:acme".
    // Its public_values.bin bytes[32..64] must equal sha256 of that string.
    const expected = Buffer.from(
      '0913644c8b396ebcee2b280e10247556a2f65c4a8e02242e5d041895cbddb043',
      'hex',
    );
    const computed = DPO2UClient.commitmentFromSubject('did:test:company:acme');
    expect(Buffer.from(computed).equals(expected)).toBe(true);
  });
});
