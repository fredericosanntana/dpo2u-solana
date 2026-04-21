/**
 * Gap #1 integration test — end-to-end verified attestation flow.
 *
 *   compliance-registry.create_verified_attestation
 *   └──CPI──▶ dpo2u-compliance-verifier.process_instruction
 *              (Groth16 pairing on the pre-generated SP1 v6 proof)
 *
 * Uses solana-bankrun to load both compiled .so files in-process and drives
 * them with a real tx built from the generated IDL.
 *
 * Fixtures come from Sprint 4c:
 *   zk-circuits/proofs/proof.bin        (356 B)
 *   zk-circuits/proofs/public_values.bin (96 B: threshold=70, subject=did:test:company:acme)
 *   zk-circuits/proofs/vkey.hex         (DPO2U program vkey hash)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, it, expect, beforeAll } from 'vitest';
import {
  startAnchor,
  BanksClient,
  ProgramTestContext,
} from 'solana-bankrun';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

import idl from '../target/idl/compliance_registry.json' assert { type: 'json' };
import { PROGRAM_IDS, deriveAttestationPda } from './helpers.js';

const VERIFIER_PROGRAM_ID = new PublicKey('9mM8YFGjVQNqdVHfidfhFd76nBnC1Cbj5bxi17AwQFuB');

const REPO_ROOT = path.resolve(__dirname, '../../');
const REGISTRY_SO_DIR = path.join(REPO_ROOT, 'solana-programs/target/deploy');
const VERIFIER_SO = path.join(REPO_ROOT, 'sp1-solana/target/deploy/dpo2u_compliance_verifier.so');
const PROOF_BIN = path.join(REPO_ROOT, 'zk-circuits/proofs/proof.bin');
const PUBLIC_VALUES_BIN = path.join(REPO_ROOT, 'zk-circuits/proofs/public_values.bin');

describe('Gap #1 — create_verified_attestation with CPI to sp1 verifier', () => {
  let coder: BorshCoder;
  let proof: Buffer;
  let publicValues: Buffer;
  let commitment: Buffer;

  beforeAll(() => {
    expect(fs.existsSync(VERIFIER_SO), `missing ${VERIFIER_SO}`).toBe(true);
    expect(fs.existsSync(PROOF_BIN), `missing ${PROOF_BIN}`).toBe(true);

    proof = fs.readFileSync(PROOF_BIN);
    publicValues = fs.readFileSync(PUBLIC_VALUES_BIN);
    expect(proof.length).toBe(356);
    expect(publicValues.length).toBe(96);

    commitment = createHash('sha256').update('did:test:company:acme').digest();
    expect(publicValues.subarray(32, 64).equals(commitment)).toBe(true);

    coder = new BorshCoder(idl as any);
  });

  async function boot() {
    // startAnchor loads the program declared in Anchor.toml + any extras passed in.
    // Extra programs array: [{ name, programId }] — .so must be at target/deploy/<name>.so
    // For the verifier at a different workspace, we use `addedPrograms`.
    const context = await startAnchor(
      path.join(REPO_ROOT, 'solana-programs'),
      [
        {
          name: 'dpo2u_compliance_verifier',
          programId: VERIFIER_PROGRAM_ID,
        },
      ],
      []
    );
    const issuer = context.payer;
    const subject = Keypair.generate();

    return {
      context,
      client: context.banksClient,
      issuer,
      subject,
    };
  }

  function buildIx(args: {
    commitment: Buffer;
    proof: Buffer;
    publicInputs: Buffer;
    issuer: PublicKey;
    subject: PublicKey;
    storageUri?: string;
    schemaId?: PublicKey;
    expiresAt?: bigint | null;
  }) {
    const data = coder.instruction.encode('create_verified_attestation', {
      // IDL keeps arg names as snake_case — must match exactly for borsh encode.
      commitment: Array.from(args.commitment),
      proof: args.proof,
      public_inputs: args.publicInputs,
      storage_uri: args.storageUri ?? 'ipfs://QmSprint4c',
      schema_id: args.schemaId ?? PublicKey.default,
      expires_at: args.expiresAt ?? null,
    });

    const [attestationPda] = deriveAttestationPda(args.subject, new Uint8Array(args.commitment));

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

  async function send(
    client: BanksClient,
    issuer: Keypair,
    ix: TransactionInstruction,
    context: ProgramTestContext
  ) {
    // Groth16 pairing via alt_bn128 syscalls consumes ~156k CU inside the
    // verifier; CPI overhead + ABI decode + account init add ~15-20k more.
    // Default 200k is not enough — bump to 400k to leave safety margin.
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const tx = new Transaction().add(computeIx).add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = issuer.publicKey;
    tx.sign(issuer);
    return client.tryProcessTransaction(tx);
  }

  // Solana-bankrun's tryProcessTransaction returns a tuple-like object where
  // element [0] is `null` on success and a TransactionError on failure.
  function isSuccess(result: any): boolean {
    // Meta is [0], err is null on success
    return !result || result.result === null || result[0] === null;
  }

  it('happy path — valid proof creates verified attestation', async () => {
    const { context, client, issuer, subject } = await boot();
    const ix = buildIx({
      commitment,
      proof,
      publicInputs: publicValues,
      issuer: issuer.publicKey,
      subject: subject.publicKey,
    });
    const result = await send(client, issuer, ix, context);
    // Debug: print on failure to see the actual error.
    if (result.result !== null && result.result !== undefined) {
      console.log('TX FAILED:', JSON.stringify(result, null, 2));
    }
    expect(result.result).toBeNull();

    const [attestationPda] = deriveAttestationPda(
      subject.publicKey,
      new Uint8Array(commitment)
    );
    const accInfo = await client.getAccount(attestationPda);
    expect(accInfo, 'attestation PDA must be initialized').toBeTruthy();

    const decoded = coder.accounts.decode('Attestation', Buffer.from(accInfo!.data));
    expect(decoded.verified).toBe(true);
    expect(decoded.threshold).toBe(70);
    expect(Buffer.from(decoded.commitment).equals(commitment)).toBe(true);
    expect(decoded.subject.toBase58()).toBe(subject.publicKey.toBase58());
    expect(decoded.issuer.toBase58()).toBe(issuer.publicKey.toBase58());
  }, 60_000);

  it('rejects tampered proof — pairing check fails in verifier CPI', async () => {
    const { context, client, issuer, subject } = await boot();
    const tampered = Buffer.from(proof);
    tampered[120] ^= 0x01; // flip a bit in the Groth16 pi_a payload
    const ix = buildIx({
      commitment,
      proof: tampered,
      publicInputs: publicValues,
      issuer: issuer.publicKey,
      subject: subject.publicKey,
    });
    const result = await send(client, issuer, ix, context);
    expect(result.result).not.toBeNull();
  }, 60_000);

  it('rejects commitment that does not match proof public values', async () => {
    const { context, client, issuer, subject } = await boot();
    const wrongCommitment = createHash('sha256').update('did:attacker:0xdead').digest();
    const ix = buildIx({
      commitment: wrongCommitment,
      proof,
      publicInputs: publicValues,
      issuer: issuer.publicKey,
      subject: subject.publicKey,
    });
    const result = await send(client, issuer, ix, context);
    expect(result.result).not.toBeNull();
  }, 60_000);

  it('rejects when meets_threshold flag is false', async () => {
    const { context, client, issuer, subject } = await boot();
    const falsifiedPv = Buffer.from(publicValues);
    falsifiedPv[95] = 0; // flip meets_threshold bool from 1 to 0
    const ix = buildIx({
      commitment,
      proof,
      publicInputs: falsifiedPv,
      issuer: issuer.publicKey,
      subject: subject.publicKey,
    });
    const result = await send(client, issuer, ix, context);
    expect(result.result).not.toBeNull();
  }, 60_000);
});
