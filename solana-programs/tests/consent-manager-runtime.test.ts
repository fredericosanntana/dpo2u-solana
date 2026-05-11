/**
 * consent-manager — runtime tests (Bucket 2 verification).
 *
 * Auditor F-001 fix (2026-05-11): record_consent now requires user Signer.
 * This test proves the DPDP §6(1) protection: data_fiduciary cannot
 * unilaterally attest consent without user co-signature.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { describe, it, expect } from 'vitest';
import { startAnchor } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

import idl from '../target/idl/consent_manager.json' assert { type: 'json' };
import { PROGRAM_IDS, deriveConsentPda } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

describe('consent_manager — runtime (Bucket 2 F-001 verification)', () => {
  const coder = new BorshCoder(idl as any);

  async function boot() {
    return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
  }

  function buildRecordConsentIx(args: {
    fiduciary: PublicKey;
    user: PublicKey;
    purposeHash: Buffer;
  }): TransactionInstruction {
    const data = coder.instruction.encode('record_consent', {
      purpose_code: 1,
      purpose_hash: Array.from(args.purposeHash),
      storage_uri: 'ipfs://Qmtest',
      expires_at: null,
    });
    const [consentPda] = deriveConsentPda(
      args.user,
      args.fiduciary,
      new Uint8Array(args.purposeHash),
    );
    return new TransactionInstruction({
      programId: PROGRAM_IDS.consent_manager,
      keys: [
        { pubkey: args.fiduciary, isSigner: true, isWritable: true },
        // Bucket 2 fix: user is now a Signer (was AccountInfo / not-signer).
        { pubkey: args.user, isSigner: true, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  it('happy path — record_consent succeeds when user co-signs', async () => {
    const context = await boot();
    const fiduciary = context.payer;
    const user = Keypair.generate();
    const purposeHash = createHash('sha256').update('purpose:newsletter').digest();

    const ix = buildRecordConsentIx({
      fiduciary: fiduciary.publicKey,
      user: user.publicKey,
      purposeHash,
    });

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = fiduciary.publicKey;
    tx.sign(fiduciary, user);

    const result = await context.banksClient.tryProcessTransaction(tx);
    expect(result.result, `tx failed: ${JSON.stringify(result)}`).toBeNull();

    const [consentPda] = deriveConsentPda(
      user.publicKey,
      fiduciary.publicKey,
      new Uint8Array(purposeHash),
    );
    const acc = await context.banksClient.getAccount(consentPda);
    expect(acc, 'consent PDA must be initialized').toBeTruthy();
    const decoded = coder.accounts.decode('ConsentRecord', Buffer.from(acc!.data));
    expect(decoded.user.toBase58()).toBe(user.publicKey.toBase58());
    // Anchor 1.0 IDL keeps snake_case; BorshCoder@0.31 preserves it for multi-word fields.
    expect(decoded.data_fiduciary.toBase58()).toBe(fiduciary.publicKey.toBase58());
  }, 60_000);

  it('rejects record_consent when user does NOT sign — DPDP §6(1) protection', async () => {
    const context = await boot();
    const fiduciary = context.payer;
    const user = Keypair.generate();
    const purposeHash = createHash('sha256').update('purpose:unauthorized').digest();

    const ix = buildRecordConsentIx({
      fiduciary: fiduciary.publicKey,
      user: user.publicKey,
      purposeHash,
    });
    // Override isSigner=false on user account to simulate forgery attempt.
    ix.keys[1].isSigner = false;

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = fiduciary.publicKey;
    tx.sign(fiduciary); // intentionally NOT signing as user

    const result = await context.banksClient.tryProcessTransaction(tx);
    // Must fail. Solana runtime rejects before program executes when a declared
    // Signer account has isSigner=false in the tx.
    expect(result.result, 'unsigned-user tx must fail').not.toBeNull();
  }, 60_000);
});
