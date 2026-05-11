/**
 * popia-info-officer-registry — runtime tests (Bucket 2 verification).
 *
 * Auditor F-001 fix (2026-05-11): register_appointment now requires
 * information_officer Signer (POPIA §55 documented acceptance).
 * Auditor F-002 fix: set_deputy_signed requires deputy co-signature.
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

import idl from '../target/idl/popia_info_officer_registry.json' assert { type: 'json' };
import { PROGRAM_IDS, derivePopiaIoPda } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

describe('popia_info_officer_registry — runtime (Bucket 2 F-001+F-002 verification)', () => {
  const coder = new BorshCoder(idl as any);

  async function boot() {
    return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
  }

  function buildRegisterIx(args: {
    responsibleParty: PublicKey;
    informationOfficer: PublicKey;
    orgIdHash: Buffer;
    contactHash: Buffer;
  }): TransactionInstruction {
    const data = coder.instruction.encode('register_appointment', {
      organization_id_hash: Array.from(args.orgIdHash),
      contact_hash: Array.from(args.contactHash),
      storage_uri: 'ipfs://QmPopiaIO',
    });
    const [pda] = derivePopiaIoPda(args.responsibleParty, new Uint8Array(args.orgIdHash));
    return new TransactionInstruction({
      programId: PROGRAM_IDS.popia_info_officer_registry,
      keys: [
        { pubkey: args.responsibleParty, isSigner: true, isWritable: true },
        // Bucket 2 fix: IO is now Signer (was AccountInfo).
        { pubkey: args.informationOfficer, isSigner: true, isWritable: false },
        { pubkey: pda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  function buildSetDeputySignedIx(args: {
    responsibleParty: PublicKey;
    deputy: PublicKey;
    pda: PublicKey;
  }): TransactionInstruction {
    const data = coder.instruction.encode('set_deputy_signed', {});
    return new TransactionInstruction({
      programId: PROGRAM_IDS.popia_info_officer_registry,
      keys: [
        { pubkey: args.responsibleParty, isSigner: true, isWritable: false },
        { pubkey: args.deputy, isSigner: true, isWritable: false },
        { pubkey: args.pda, isSigner: false, isWritable: true },
      ],
      data,
    });
  }

  it('happy path — register_appointment succeeds when IO co-signs', async () => {
    const context = await boot();
    const rp = context.payer;
    const io = Keypair.generate();
    const orgHash = createHash('sha256').update('CIPC-2026/0001').digest();
    const contactHash = createHash('sha256').update('io@dpo2u.com').digest();

    const ix = buildRegisterIx({
      responsibleParty: rp.publicKey,
      informationOfficer: io.publicKey,
      orgIdHash: orgHash,
      contactHash,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = rp.publicKey;
    tx.sign(rp, io);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `tx failed: ${JSON.stringify(r)}`).toBeNull();

    const [pda] = derivePopiaIoPda(rp.publicKey, new Uint8Array(orgHash));
    const acc = await context.banksClient.getAccount(pda);
    expect(acc).toBeTruthy();
    const decoded = coder.accounts.decode('InfoOfficerAppointment', Buffer.from(acc!.data));
    // Anchor 1.0 IDL snake_case preserved by BorshCoder@0.31 for multi-word fields.
    expect(decoded.responsible_party.toBase58()).toBe(rp.publicKey.toBase58());
    expect(decoded.information_officer.toBase58()).toBe(io.publicKey.toBase58());
  }, 60_000);

  it('rejects register without IO signature — POPIA §55 acceptance', async () => {
    const context = await boot();
    const rp = context.payer;
    const io = Keypair.generate();
    const orgHash = createHash('sha256').update('CIPC-2026/0002').digest();
    const contactHash = createHash('sha256').update('fake@example.com').digest();

    const ix = buildRegisterIx({
      responsibleParty: rp.publicKey,
      informationOfficer: io.publicKey,
      orgIdHash: orgHash,
      contactHash,
    });
    ix.keys[1].isSigner = false; // IO not signing

    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = rp.publicKey;
    tx.sign(rp);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'unsigned-IO must fail').not.toBeNull();
  }, 60_000);

  it('set_deputy_signed succeeds when deputy co-signs', async () => {
    const context = await boot();
    const rp = context.payer;
    const io = Keypair.generate();
    const deputy = Keypair.generate();
    const orgHash = createHash('sha256').update('CIPC-2026/0003').digest();
    const contactHash = createHash('sha256').update('io@example.com').digest();

    // Register first
    const registerIx = buildRegisterIx({
      responsibleParty: rp.publicKey,
      informationOfficer: io.publicKey,
      orgIdHash: orgHash,
      contactHash,
    });
    const tx1 = new Transaction().add(registerIx);
    tx1.recentBlockhash = context.lastBlockhash;
    tx1.feePayer = rp.publicKey;
    tx1.sign(rp, io);
    expect((await context.banksClient.tryProcessTransaction(tx1)).result).toBeNull();

    const [pda] = derivePopiaIoPda(rp.publicKey, new Uint8Array(orgHash));

    const setIx = buildSetDeputySignedIx({
      responsibleParty: rp.publicKey,
      deputy: deputy.publicKey,
      pda,
    });
    const tx2 = new Transaction().add(setIx);
    tx2.recentBlockhash = context.lastBlockhash;
    tx2.feePayer = rp.publicKey;
    tx2.sign(rp, deputy);

    const r = await context.banksClient.tryProcessTransaction(tx2);
    expect(r.result, `set_deputy failed: ${JSON.stringify(r)}`).toBeNull();

    const acc = await context.banksClient.getAccount(pda);
    const decoded = coder.accounts.decode('InfoOfficerAppointment', Buffer.from(acc!.data));
    expect(decoded.deputy?.toBase58?.()).toBe(deputy.publicKey.toBase58());
  }, 60_000);
});
