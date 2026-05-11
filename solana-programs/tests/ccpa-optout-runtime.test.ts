/**
 * ccpa-optout-registry — runtime tests (Bucket 2 verification).
 *
 * Auditor F-001 fix (2026-05-11): register_optout now requires consumer Signer
 * + OptoutRecord stores consumer pubkey. reverse_optout checks consumer matches
 * — protects against business-initiated reversal per CCPA §1798.135(c).
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

import idl from '../target/idl/ccpa_optout_registry.json' assert { type: 'json' };
import { PROGRAM_IDS, deriveCcpaOptoutPda } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

const OPTOUT_SALE = 1;

describe('ccpa_optout_registry — runtime (Bucket 2 F-001 verification)', () => {
  const coder = new BorshCoder(idl as any);

  async function boot() {
    return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
  }

  function buildRegisterIx(args: {
    business: PublicKey;
    consumer: PublicKey;
    consumerHash: Buffer;
  }): TransactionInstruction {
    const data = coder.instruction.encode('register_optout', {
      consumer_commitment_hash: Array.from(args.consumerHash),
      optout_kind: OPTOUT_SALE,
      via_gpc: true,
      storage_uri: 'ipfs://QmCcpaTest',
    });
    const [pda] = deriveCcpaOptoutPda(
      args.business,
      new Uint8Array(args.consumerHash),
      OPTOUT_SALE,
    );
    return new TransactionInstruction({
      programId: PROGRAM_IDS.ccpa_optout_registry,
      keys: [
        { pubkey: args.business, isSigner: true, isWritable: true },
        // Bucket 2 fix: consumer is now a Signer.
        { pubkey: args.consumer, isSigner: true, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  function buildReverseIx(args: {
    consumerSigner: PublicKey;
    pda: PublicKey;
  }): TransactionInstruction {
    const data = coder.instruction.encode('reverse_optout', {});
    return new TransactionInstruction({
      programId: PROGRAM_IDS.ccpa_optout_registry,
      keys: [
        { pubkey: args.consumerSigner, isSigner: true, isWritable: false },
        { pubkey: args.pda, isSigner: false, isWritable: true },
      ],
      data,
    });
  }

  it('happy path — register_optout succeeds when consumer co-signs', async () => {
    const context = await boot();
    const business = context.payer;
    const consumer = Keypair.generate();
    const consumerHash = createHash('sha256').update('consumer:opaque:42').digest();

    const ix = buildRegisterIx({
      business: business.publicKey,
      consumer: consumer.publicKey,
      consumerHash,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = business.publicKey;
    tx.sign(business, consumer);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `register failed: ${JSON.stringify(r)}`).toBeNull();

    const [pda] = deriveCcpaOptoutPda(
      business.publicKey,
      new Uint8Array(consumerHash),
      OPTOUT_SALE,
    );
    const acc = await context.banksClient.getAccount(pda);
    expect(acc).toBeTruthy();
    const decoded = coder.accounts.decode('OptoutRecord', Buffer.from(acc!.data));
    expect(decoded.consumer.toBase58()).toBe(consumer.publicKey.toBase58());
    expect(decoded.optout_kind).toBe(OPTOUT_SALE);
    expect(decoded.via_gpc).toBe(true);
  }, 60_000);

  it('rejects reverse_optout by business — only consumer can reverse (CCPA §1798.135(c))', async () => {
    const context = await boot();
    const business = context.payer;
    const consumer = Keypair.generate();
    const consumerHash = createHash('sha256').update('consumer:opaque:99').digest();

    // 1. Register with consumer.
    const registerIx = buildRegisterIx({
      business: business.publicKey,
      consumer: consumer.publicKey,
      consumerHash,
    });
    const tx1 = new Transaction().add(registerIx);
    tx1.recentBlockhash = context.lastBlockhash;
    tx1.feePayer = business.publicKey;
    tx1.sign(business, consumer);
    const r1 = await context.banksClient.tryProcessTransaction(tx1);
    expect(r1.result).toBeNull();

    const [pda] = deriveCcpaOptoutPda(
      business.publicKey,
      new Uint8Array(consumerHash),
      OPTOUT_SALE,
    );

    // 2. Business tries to reverse on its own — must fail with UnauthorizedConsumer.
    const reverseIx = buildReverseIx({
      consumerSigner: business.publicKey, // business pretending to be consumer
      pda,
    });
    const tx2 = new Transaction().add(reverseIx);
    tx2.recentBlockhash = context.lastBlockhash;
    tx2.feePayer = business.publicKey;
    tx2.sign(business);
    const r2 = await context.banksClient.tryProcessTransaction(tx2);
    expect(r2.result, 'business-initiated reverse must fail').not.toBeNull();
  }, 60_000);

  it('happy path reverse — consumer reverses their own opt-out', async () => {
    const context = await boot();
    const business = context.payer;
    const consumer = Keypair.generate();
    const consumerHash = createHash('sha256').update('consumer:opaque:111').digest();

    // Fund consumer so they can pay tx fee for reverse.
    const fund = SystemProgram.transfer({
      fromPubkey: business.publicKey,
      toPubkey: consumer.publicKey,
      lamports: 100_000_000,
    });
    const txFund = new Transaction().add(fund);
    txFund.recentBlockhash = context.lastBlockhash;
    txFund.feePayer = business.publicKey;
    txFund.sign(business);
    await context.banksClient.tryProcessTransaction(txFund);

    const registerIx = buildRegisterIx({
      business: business.publicKey,
      consumer: consumer.publicKey,
      consumerHash,
    });
    const tx1 = new Transaction().add(registerIx);
    tx1.recentBlockhash = context.lastBlockhash;
    tx1.feePayer = business.publicKey;
    tx1.sign(business, consumer);
    expect((await context.banksClient.tryProcessTransaction(tx1)).result).toBeNull();

    const [pda] = deriveCcpaOptoutPda(
      business.publicKey,
      new Uint8Array(consumerHash),
      OPTOUT_SALE,
    );

    const reverseIx = buildReverseIx({
      consumerSigner: consumer.publicKey,
      pda,
    });
    const tx2 = new Transaction().add(reverseIx);
    tx2.recentBlockhash = context.lastBlockhash;
    tx2.feePayer = consumer.publicKey;
    tx2.sign(consumer);
    const r = await context.banksClient.tryProcessTransaction(tx2);
    expect(r.result, `consumer-reverse failed: ${JSON.stringify(r)}`).toBeNull();

    const acc = await context.banksClient.getAccount(pda);
    const decoded = coder.accounts.decode('OptoutRecord', Buffer.from(acc!.data));
    expect(decoded.reversed_at).not.toBeNull();
  }, 60_000);
});
