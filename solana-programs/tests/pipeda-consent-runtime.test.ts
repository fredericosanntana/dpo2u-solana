/**
 * pipeda-consent-extension — runtime tests (Bucket 2 verification).
 *
 * Auditor F-001 fix (2026-05-11): record_pipeda_consent now requires
 * subject Signer. Proves PIPEDA Schedule 1 Principle 4 "meaningful consent"
 * compliance.
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

import idl from '../target/idl/pipeda_consent_extension.json' assert { type: 'json' };
import { PROGRAM_IDS, derivePipedaConsentPda } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

const CONSENT_EXPRESS = 1;

describe('pipeda_consent_extension — runtime (Bucket 2 F-001 verification)', () => {
  const coder = new BorshCoder(idl as any);

  async function boot() {
    return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
  }

  function buildIx(args: {
    organization: PublicKey;
    subject: PublicKey;
    purposeHash: Buffer;
  }): TransactionInstruction {
    const data = coder.instruction.encode('record_pipeda_consent', {
      purpose_code: 7,
      purpose_hash: Array.from(args.purposeHash),
      consent_form: CONSENT_EXPRESS,
      // Principle bits 1,2,3,4 set (bits 0..3) = 0b0000_0000_0000_1111 = 0x0F
      principles_evidenced: 0x0F,
      cross_border_destination: null,
      storage_uri: 'ipfs://QmpipedaTest',
    });
    const [pda] = derivePipedaConsentPda(
      args.subject,
      args.organization,
      new Uint8Array(args.purposeHash),
    );
    return new TransactionInstruction({
      programId: PROGRAM_IDS.pipeda_consent_extension,
      keys: [
        { pubkey: args.organization, isSigner: true, isWritable: true },
        // Bucket 2 fix: subject is now a Signer (was AccountInfo).
        { pubkey: args.subject, isSigner: true, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  it('happy path — record_pipeda_consent succeeds when subject co-signs', async () => {
    const context = await boot();
    const org = context.payer;
    const subject = Keypair.generate();
    const purposeHash = createHash('sha256').update('purpose:marketing_emails').digest();

    const ix = buildIx({
      organization: org.publicKey,
      subject: subject.publicKey,
      purposeHash,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = org.publicKey;
    tx.sign(org, subject);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `tx failed: ${JSON.stringify(r)}`).toBeNull();

    const [pda] = derivePipedaConsentPda(
      subject.publicKey,
      org.publicKey,
      new Uint8Array(purposeHash),
    );
    const acc = await context.banksClient.getAccount(pda);
    expect(acc).toBeTruthy();
    const decoded = coder.accounts.decode('PipedaConsentRecord', Buffer.from(acc!.data));
    expect(decoded.subject.toBase58()).toBe(subject.publicKey.toBase58());
    // Anchor 1.0 IDL snake_case preserved by BorshCoder@0.31 for multi-word fields.
    expect(decoded.consent_form).toBe(CONSENT_EXPRESS);
  }, 60_000);

  it('rejects record without subject signature — PIPEDA Principle 4', async () => {
    const context = await boot();
    const org = context.payer;
    const subject = Keypair.generate();
    const purposeHash = createHash('sha256').update('purpose:fake_consent').digest();

    const ix = buildIx({
      organization: org.publicKey,
      subject: subject.publicKey,
      purposeHash,
    });
    ix.keys[1].isSigner = false; // subject not signing

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = org.publicKey;
    tx.sign(org);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'unsigned-subject tx must fail').not.toBeNull();
  }, 60_000);

  it('rejects invalid principles_evidenced bitmap (Bucket 1 F-002)', async () => {
    const context = await boot();
    const org = context.payer;
    const subject = Keypair.generate();
    const purposeHash = createHash('sha256').update('purpose:bitmap_test').digest();

    // Bit 10 is undefined (only 10 principles, indices 0-9). 0x0400 must reject.
    const data = coder.instruction.encode('record_pipeda_consent', {
      purpose_code: 1,
      purpose_hash: Array.from(purposeHash),
      consent_form: CONSENT_EXPRESS,
      principles_evidenced: 0x0400,
      cross_border_destination: null,
      storage_uri: 'ipfs://QmBitmapTest',
    });
    const [pda] = derivePipedaConsentPda(
      subject.publicKey,
      org.publicKey,
      new Uint8Array(purposeHash),
    );
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.pipeda_consent_extension,
      keys: [
        { pubkey: org.publicKey, isSigner: true, isWritable: true },
        { pubkey: subject.publicKey, isSigner: true, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = org.publicKey;
    tx.sign(org, subject);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'bitmap with bit 10 set must fail').not.toBeNull();
  }, 60_000);
});
