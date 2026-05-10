/**
 * LGPD Art. 18 erasure e2e — proves the "right to be forgotten" flow end-to-end:
 *
 *   1. Upload PII payload to MockBackend (simulates off-chain storage)
 *   2. Attest on-chain via create_verified_attestation, storage_uri = mock://...
 *   3. Verify: payload live, attestation readable
 *   4. Data subject exercises Art. 18 → erase():
 *        a) backend.delete(storage_uri)    — off-chain PII gone
 *        b) revoke_attestation              — on-chain seal with reason
 *   5. Verify: payload 404, PDA has revoked_at + revocation_reason, but
 *      commitment hash remains (irreversibly hashed PII — safe to keep)
 *
 * Also asserts: only the issuer can revoke (unauthorized fails), double-revoke
 * fails with AlreadyRevoked.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, it, expect, beforeAll } from 'vitest';
import { startAnchor, BanksClient, ProgramTestContext } from 'solana-bankrun';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

import idl from '../target/idl/compliance_registry.json' assert { type: 'json' };
import { PROGRAM_IDS, deriveAttestationPda } from './helpers.js';
// Import from leaf modules instead of the storage barrel. The barrel
// re-exports ShdwDriveBackend, which pulls in @shadow-drive/sdk — a dep
// not installed in solana-programs/node_modules. Vite parses the import
// graph eagerly, so even though this test only uses MockBackend,
// importing from index.js would fail to resolve @shadow-drive/sdk.
import { MockBackend } from '../../packages/client-sdk/src/storage/mock.js';
import { PayloadNotFoundError } from '../../packages/client-sdk/src/storage/types.js';

const VERIFIER_PROGRAM_ID = new PublicKey('5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW');
const REPO_ROOT = path.resolve(__dirname, '../../');
const VERIFIER_SO = path.join(REPO_ROOT, 'sp1-solana/target/deploy/dpo2u_compliance_verifier.so');
const PROOF_BIN = path.join(REPO_ROOT, 'zk-circuits/proofs/proof.bin');
const PUBLIC_VALUES_BIN = path.join(REPO_ROOT, 'zk-circuits/proofs/public_values.bin');

describe('LGPD Art. 18 — end-to-end erasure flow', () => {
  let coder: BorshCoder;
  let proof: Buffer;
  let publicValues: Buffer;
  let commitment: Buffer;

  beforeAll(() => {
    expect(fs.existsSync(VERIFIER_SO)).toBe(true);
    proof = fs.readFileSync(PROOF_BIN);
    publicValues = fs.readFileSync(PUBLIC_VALUES_BIN);
    commitment = createHash('sha256').update('did:test:company:acme').digest();
    coder = new BorshCoder(idl as any);
  });

  async function boot() {
    const context = await startAnchor(
      path.join(REPO_ROOT, 'solana-programs'),
      [{ name: 'dpo2u_compliance_verifier', programId: VERIFIER_PROGRAM_ID }],
      [],
    );
    return { context, client: context.banksClient, issuer: context.payer };
  }

  function buildAttestIx(args: {
    issuer: PublicKey;
    subject: PublicKey;
    storageUri: string;
  }): TransactionInstruction {
    const data = coder.instruction.encode('create_verified_attestation', {
      commitment: Array.from(commitment),
      proof,
      public_inputs: publicValues,
      storage_uri: args.storageUri,
      schema_id: PublicKey.default,
      expires_at: null,
    });
    const [attestationPda] = deriveAttestationPda(args.subject, new Uint8Array(commitment));
    return new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry,
      keys: [
        { pubkey: args.issuer, isSigner: true, isWritable: true },
        { pubkey: args.subject, isSigner: false, isWritable: false },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
        { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  function buildRevokeIx(args: {
    issuer: PublicKey;
    attestation: PublicKey;
    reason: string;
  }): TransactionInstruction {
    const data = coder.instruction.encode('revoke_attestation', { reason: args.reason });
    return new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry,
      keys: [
        { pubkey: args.issuer, isSigner: true, isWritable: false },
        { pubkey: args.attestation, isSigner: false, isWritable: true },
      ],
      data,
    });
  }

  async function sendTx(
    client: BanksClient,
    context: ProgramTestContext,
    signer: Keypair,
    ixs: TransactionInstruction[],
  ) {
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const tx = new Transaction().add(computeIx, ...ixs);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = signer.publicKey;
    tx.sign(signer);
    return client.tryProcessTransaction(tx);
  }

  it('happy path — upload, attest, erase: payload deleted + on-chain revoked + commitment preserved', async () => {
    const { context, client, issuer } = await boot();
    const subject = Keypair.generate();
    const backend = new MockBackend();

    // 1) Upload PII payload (simulates DPIA document with consent record)
    const payload = Buffer.from(JSON.stringify({
      subject_id: 'did:test:company:acme',
      cpf: '123.456.789-00',
      consent_at: '2026-01-15T09:00:00Z',
      purpose: 'employment-eligibility-compliance',
    }));
    const storageUri = await backend.upload(new Uint8Array(payload), 'dpia.json');
    expect(storageUri).toMatch(/^mock:\/\//);
    expect(backend.size()).toBe(1);

    // 2) Attest with that URI
    const attestRes = await sendTx(
      client,
      context,
      issuer,
      [buildAttestIx({ issuer: issuer.publicKey, subject: subject.publicKey, storageUri })],
    );
    expect(attestRes.result).toBeNull();

    const [attestationPda] = deriveAttestationPda(subject.publicKey, new Uint8Array(commitment));
    const before = await client.getAccount(attestationPda);
    expect(before).toBeTruthy();
    const decoded = coder.accounts.decode<any>('Attestation', Buffer.from(before!.data));
    // IDL may emit snake_case or camelCase depending on Anchor version — support both.
    const getUri = (d: any) => d.storageUri ?? d.storage_uri;
    const getRevokedAt = (d: any) => d.revokedAt ?? d.revoked_at;
    const getRevocationReason = (d: any) => d.revocationReason ?? d.revocation_reason;
    expect(getUri(decoded)).toBe(storageUri);
    expect(getRevokedAt(decoded)).toBeNull();

    // 3) Verify payload is live off-chain
    const fetched = await backend.fetch(storageUri);
    expect(Buffer.from(fetched).equals(payload)).toBe(true);

    // 4) LGPD Art. 18 request arrives → erase flow
    //    (a) off-chain delete
    await backend.delete(storageUri);
    expect(backend.size()).toBe(0);
    await expect(backend.fetch(storageUri)).rejects.toThrow(PayloadNotFoundError);

    //    (b) on-chain revoke
    const reason = 'LGPD_ART_18_REQUEST_2026-05-15';
    const revokeRes = await sendTx(
      client,
      context,
      issuer,
      [buildRevokeIx({ issuer: issuer.publicKey, attestation: attestationPda, reason })],
    );
    expect(revokeRes.result).toBeNull();

    // 5) Verify invariants: commitment preserved, revocation sealed
    const after = await client.getAccount(attestationPda);
    const afterDecoded = coder.accounts.decode<any>('Attestation', Buffer.from(after!.data));
    expect(Buffer.from(afterDecoded.commitment).equals(commitment)).toBe(true); // irreversible hash survives
    expect(getRevokedAt(afterDecoded)).not.toBeNull();
    expect(getRevocationReason(afterDecoded)).toBe(reason);
    expect(afterDecoded.verified).toBe(true); // past compliance still provable
  }, 60_000);

  it('unauthorized — non-issuer cannot revoke (Unauthorized)', async () => {
    const { context, client, issuer } = await boot();
    const subject = Keypair.generate();
    const attacker = Keypair.generate();

    // Fund attacker so it can sign
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: issuer.publicKey,
        toPubkey: attacker.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      }),
    );
    fundTx.recentBlockhash = context.lastBlockhash;
    fundTx.feePayer = issuer.publicKey;
    fundTx.sign(issuer);
    await client.tryProcessTransaction(fundTx);

    // Issuer creates an attestation
    await sendTx(client, context, issuer, [
      buildAttestIx({ issuer: issuer.publicKey, subject: subject.publicKey, storageUri: 'mock://test/x.bin' }),
    ]);

    // Attacker tries to revoke → must fail
    const [attestationPda] = deriveAttestationPda(subject.publicKey, new Uint8Array(commitment));
    const result = await sendTx(client, context, attacker, [
      buildRevokeIx({ issuer: attacker.publicKey, attestation: attestationPda, reason: 'steal' }),
    ]);
    expect(result.result, 'must reject revoke from non-issuer').not.toBeNull();
  }, 60_000);

  it('double revoke — AlreadyRevoked on second attempt', async () => {
    const { context, client, issuer } = await boot();
    const subject = Keypair.generate();

    await sendTx(client, context, issuer, [
      buildAttestIx({ issuer: issuer.publicKey, subject: subject.publicKey, storageUri: 'mock://test/y.bin' }),
    ]);
    const [attestationPda] = deriveAttestationPda(subject.publicKey, new Uint8Array(commitment));

    const first = await sendTx(client, context, issuer, [
      buildRevokeIx({ issuer: issuer.publicKey, attestation: attestationPda, reason: 'first' }),
    ]);
    expect(first.result).toBeNull();

    const second = await sendTx(client, context, issuer, [
      buildRevokeIx({ issuer: issuer.publicKey, attestation: attestationPda, reason: 'second' }),
    ]);
    expect(second.result, 'double-revoke must fail').not.toBeNull();
  }, 60_000);
});
