/**
 * Gap #5 integration tests — SPL Token CPI in payment-gateway + fee-distributor.
 *
 * Uses solana-bankrun + @solana/spl-token to prove the two programs actually
 * move tokens (vs the previous scaffold that only emitted events). Covers:
 *   - payment-gateway: happy path (payer → payee) + MintMismatch revert
 *   - fee-distributor: 70/20/10 split hitting 3 ATAs atomically
 */

import * as path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { startAnchor, BanksClient, ProgramTestContext } from 'solana-bankrun';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  AccountLayout,
} from '@solana/spl-token';
import { BorshCoder, BN } from '@coral-xyz/anchor';

import pgIdl from '../target/idl/payment_gateway.json' assert { type: 'json' };
import fdIdl from '../target/idl/fee_distributor.json' assert { type: 'json' };
import {
  PROGRAM_IDS,
  deriveInvoicePda,
  deriveFeeConfigPda,
} from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

async function boot(): Promise<ProgramTestContext> {
  return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
}

async function readTokenBalance(client: BanksClient, ata: PublicKey): Promise<bigint> {
  const acc = await client.getAccount(ata);
  if (!acc) return 0n;
  const decoded = AccountLayout.decode(Buffer.from(acc.data));
  return decoded.amount;
}

async function createAccountIx(
  context: ProgramTestContext,
  newAccount: Keypair,
  size: number,
  owner: PublicKey,
): Promise<TransactionInstruction> {
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(size)));
  return SystemProgram.createAccount({
    fromPubkey: context.payer.publicKey,
    newAccountPubkey: newAccount.publicKey,
    lamports,
    space: size,
    programId: owner,
  });
}

async function setupMintAndAtas(
  context: ProgramTestContext,
  owners: PublicKey[],
  decimals = 6,
): Promise<{ mint: PublicKey; atas: PublicKey[] }> {
  const client = context.banksClient;
  const mintKp = Keypair.generate();
  const mintAuthority = context.payer;

  const ataKps = owners.map(() => Keypair.generate());

  // One tx: create mint account + initialize + create each account + initialize each.
  const tx = new Transaction();
  tx.add(await createAccountIx(context, mintKp, MINT_SIZE, TOKEN_PROGRAM_ID));
  tx.add(
    createInitializeMint2Instruction(
      mintKp.publicKey,
      decimals,
      mintAuthority.publicKey,
      null,
      TOKEN_PROGRAM_ID,
    ),
  );
  for (let i = 0; i < owners.length; i++) {
    tx.add(await createAccountIx(context, ataKps[i], ACCOUNT_SIZE, TOKEN_PROGRAM_ID));
    tx.add(
      createInitializeAccount3Instruction(
        ataKps[i].publicKey,
        mintKp.publicKey,
        owners[i],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer, mintKp, ...ataKps);
  const r = await client.tryProcessTransaction(tx);
  expect(r.result, `setup mint/atas failed: ${JSON.stringify(r)}`).toBeNull();

  return { mint: mintKp.publicKey, atas: ataKps.map((k) => k.publicKey) };
}

async function mintTo(
  context: ProgramTestContext,
  mint: PublicKey,
  dest: PublicKey,
  amount: bigint,
): Promise<void> {
  const ix = createMintToInstruction(mint, dest, context.payer.publicKey, amount, [], TOKEN_PROGRAM_ID);
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `mintTo failed: ${JSON.stringify(r)}`).toBeNull();
}

describe('Gap #5a — payment-gateway SPL Token CPI', () => {
  const pgCoder = new BorshCoder(pgIdl as any);

  async function createInvoice(
    context: ProgramTestContext,
    payer: Keypair,
    payee: PublicKey,
    mint: PublicKey,
    toolName: string,
    amount: bigint,
    nonce: bigint,
  ): Promise<PublicKey> {
    const [invoicePda] = deriveInvoicePda(payer.publicKey, toolName, nonce);
    const data = pgCoder.instruction.encode('create_invoice', {
      tool_name: toolName,
      amount: new BN(amount.toString()),
      mint,
      nonce: new BN(nonce.toString()),
    });
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.payment_gateway,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: payee, isSigner: false, isWritable: false },
        { pubkey: invoicePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `create_invoice failed: ${JSON.stringify(r)}`).toBeNull();
    return invoicePda;
  }

  async function settleInvoice(
    context: ProgramTestContext,
    payer: Keypair,
    invoicePda: PublicKey,
    payerAta: PublicKey,
    payeeAta: PublicKey,
    mint: PublicKey,
    settledAmount: bigint,
  ) {
    const data = pgCoder.instruction.encode('settle_invoice', { settled_amount: new BN(settledAmount.toString()) });
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.payment_gateway,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: invoicePda, isSigner: false, isWritable: true },
        { pubkey: payerAta, isSigner: false, isWritable: true },
        { pubkey: payeeAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    return context.banksClient.tryProcessTransaction(tx);
  }

  it('happy path — settle_invoice moves tokens from payer_ata to payee_ata', async () => {
    const context = await boot();
    const payer = Keypair.generate();
    const payee = Keypair.generate();

    // Fund payer with SOL so it can sign txs
    const transfer = SystemProgram.transfer({
      fromPubkey: context.payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    });
    const fundTx = new Transaction().add(transfer);
    fundTx.recentBlockhash = context.lastBlockhash;
    fundTx.feePayer = context.payer.publicKey;
    fundTx.sign(context.payer);
    await context.banksClient.tryProcessTransaction(fundTx);

    const { mint, atas } = await setupMintAndAtas(context, [payer.publicKey, payee.publicKey]);
    const [payerAta, payeeAta] = atas;

    await mintTo(context, mint, payerAta, 1_000_000n);
    expect(await readTokenBalance(context.banksClient, payerAta)).toBe(1_000_000n);

    const invoicePda = await createInvoice(
      context,
      payer,
      payee.publicKey,
      mint,
      'zk_compliance_proof',
      100_000n,
      42n,
    );

    const r = await settleInvoice(context, payer, invoicePda, payerAta, payeeAta, mint, 100_000n);
    expect(r.result, `settle_invoice failed: ${JSON.stringify(r)}`).toBeNull();

    expect(await readTokenBalance(context.banksClient, payerAta)).toBe(900_000n);
    expect(await readTokenBalance(context.banksClient, payeeAta)).toBe(100_000n);
  }, 60_000);

  it('rejects settle with mint ≠ invoice.mint (MintMismatch)', async () => {
    const context = await boot();
    const payer = Keypair.generate();
    const payee = Keypair.generate();

    const transfer = SystemProgram.transfer({
      fromPubkey: context.payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    });
    const fundTx = new Transaction().add(transfer);
    fundTx.recentBlockhash = context.lastBlockhash;
    fundTx.feePayer = context.payer.publicKey;
    fundTx.sign(context.payer);
    await context.banksClient.tryProcessTransaction(fundTx);

    // Setup TWO mints. Create invoice for mint1, try to settle with mint2 accounts.
    const { mint: mint1, atas: atas1 } = await setupMintAndAtas(context, [
      payer.publicKey,
      payee.publicKey,
    ]);
    const { mint: mint2, atas: atas2 } = await setupMintAndAtas(context, [
      payer.publicKey,
      payee.publicKey,
    ]);
    await mintTo(context, mint2, atas2[0], 500_000n);

    const invoicePda = await createInvoice(
      context,
      payer,
      payee.publicKey,
      mint1, // invoice declares mint1
      'zk_compliance_proof',
      100_000n,
      7n,
    );

    // Pass mint2 + mint2's ATAs — program should reject with MintMismatch.
    const r = await settleInvoice(context, payer, invoicePda, atas2[0], atas2[1], mint2, 100_000n);
    expect(r.result, 'must revert on mint mismatch').not.toBeNull();
  }, 60_000);
});

describe('Gap #5b — fee-distributor 70/20/10 SPL Token split', () => {
  const fdCoder = new BorshCoder(fdIdl as any);

  async function initConfig(
    context: ProgramTestContext,
    authority: Keypair,
    treasury: PublicKey,
    operator: PublicKey,
    reserve: PublicKey,
  ): Promise<PublicKey> {
    const [configPda] = deriveFeeConfigPda();
    const data = fdCoder.instruction.encode('initialize', { treasury, operator, reserve });
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.fee_distributor,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);
    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `initialize failed: ${JSON.stringify(r)}`).toBeNull();
    return configPda;
  }

  it('distribute — 1,000,000 splits into 700k / 200k / 100k across 3 ATAs', async () => {
    const context = await boot();
    const authority = context.payer;

    // Treasury, operator, reserve are arbitrary wallets for this test.
    const treasury = Keypair.generate();
    const operator = Keypair.generate();
    const reserve = Keypair.generate();
    const source = Keypair.generate();

    // Fund source with SOL so it can sign the distribute tx.
    const transfer = SystemProgram.transfer({
      fromPubkey: context.payer.publicKey,
      toPubkey: source.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    });
    const fundTx = new Transaction().add(transfer);
    fundTx.recentBlockhash = context.lastBlockhash;
    fundTx.feePayer = context.payer.publicKey;
    fundTx.sign(context.payer);
    await context.banksClient.tryProcessTransaction(fundTx);

    const { mint, atas } = await setupMintAndAtas(context, [
      source.publicKey,
      treasury.publicKey,
      operator.publicKey,
      reserve.publicKey,
    ]);
    const [sourceAta, treasuryAta, operatorAta, reserveAta] = atas;

    await mintTo(context, mint, sourceAta, 1_000_000n);
    const configPda = await initConfig(
      context,
      authority,
      treasury.publicKey,
      operator.publicKey,
      reserve.publicKey,
    );

    const data = fdCoder.instruction.encode('distribute', { amount: new BN(1_000_000) });
    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.fee_distributor,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: source.publicKey, isSigner: true, isWritable: false },
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: operatorAta, isSigner: false, isWritable: true },
        { pubkey: reserveAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = source.publicKey;
    tx.sign(source);
    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `distribute failed: ${JSON.stringify(r)}`).toBeNull();

    expect(await readTokenBalance(context.banksClient, treasuryAta)).toBe(700_000n);
    expect(await readTokenBalance(context.banksClient, operatorAta)).toBe(200_000n);
    expect(await readTokenBalance(context.banksClient, reserveAta)).toBe(100_000n);
    expect(await readTokenBalance(context.banksClient, sourceAta)).toBe(0n);
  }, 60_000);
});
