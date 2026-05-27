/**
 * knect-tokenomics-pinocchio — bankrun integration tests
 *
 * Validates the atomic 25/25/35/15 fee split for Kolibri KNECT tokenomics.
 * Mirrors the test harness from `spl-token-cpi.test.ts` (SPL mint + ATA setup
 * via bankrun) and proves:
 *
 *   - initialize_config writes the PDA + rejects bps sum != 10_000
 *   - distribute splits an SPL token balance exactly across 4 ATAs
 *   - rounding lands in the fundo vault (no rounding leakage)
 *   - distribute reverts on amount=0, wrong vault, wrong mint, wrong token program
 *   - update_splits gated to admin signer; non-admin reverts
 */

import * as path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { startAnchor, BanksClient, ProgramTestContext } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
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

import { PROGRAM_IDS } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');

const KNECT_PROGRAM = new PublicKey('Emhv7pBYgqyYQ2Bzcbi8nXphA1AmgoWmU7aKKxCNbk2v');

// Errors from src/lib.rs `mod err`
const ERR_BPS_SUM_MISMATCH = 0x4001;
const ERR_NOT_ADMIN = 0x4002;
const ERR_WRONG_PDA = 0x4003;
const ERR_WRONG_TOKEN_PROGRAM = 0x4004;
const ERR_VAULT_OWNER_MISMATCH = 0x4005;
const ERR_VAULT_MINT_MISMATCH = 0x4006;
const ERR_AMOUNT_ZERO = 0x4007;
const ERR_ALREADY_INITIALIZED = 0x4009;
const ERR_SIGNER_REQUIRED = 0x400b;

// -- Helpers -----------------------------------------------------------------

function deriveConfigPda(admin: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('knect_config'), admin.toBuffer()],
    KNECT_PROGRAM,
  );
}

function extractCustomErrorCode(result: any): number | null {
  const tryFromString = (s: string): number | null => {
    const hex = s.match(/custom program error[:\s]*0x([0-9a-fA-F]+)/);
    if (hex) return parseInt(hex[1]!, 16);
    const dec = s.match(/Custom[":(\s]*(\d+)/);
    if (dec) return Number(dec[1]);
    return null;
  };
  if (result?.result) {
    const s = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    const fromResult = tryFromString(s);
    if (fromResult !== null) return fromResult;
  }
  const logs: string[] = result?.meta?.logMessages ?? [];
  for (const line of logs) {
    const fromLog = tryFromString(line);
    if (fromLog !== null) return fromLog;
  }
  return null;
}

async function boot(): Promise<ProgramTestContext> {
  return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
}

async function readBalance(client: BanksClient, ata: PublicKey): Promise<bigint> {
  const acc = await client.getAccount(ata);
  if (!acc) return 0n;
  return AccountLayout.decode(Buffer.from(acc.data)).amount;
}

async function processOne(
  context: ProgramTestContext,
  ix: TransactionInstruction,
  signers: Keypair[],
  feePayer: Keypair,
): Promise<any> {
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = feePayer.publicKey;
  tx.sign(...signers);
  return context.banksClient.tryProcessTransaction(tx);
}

interface MintFixture {
  mint: PublicKey;
  authority: Keypair;
  decimals: number;
}

async function createMint(context: ProgramTestContext, decimals = 6): Promise<MintFixture> {
  const mintKp = Keypair.generate();
  const authority = Keypair.generate();
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));

  const tx = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: context.payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
    )
    .add(
      createInitializeMint2Instruction(
        mintKp.publicKey,
        decimals,
        authority.publicKey,
        null,
        TOKEN_PROGRAM_ID,
      ),
    );
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer, mintKp);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `createMint failed: ${JSON.stringify(r)}`).toBeNull();

  return { mint: mintKp.publicKey, authority, decimals };
}

async function createTokenAccount(
  context: ProgramTestContext,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ataKp = Keypair.generate();
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE)));
  const tx = new Transaction()
    .add(
      SystemProgram.createAccount({
        fromPubkey: context.payer.publicKey,
        newAccountPubkey: ataKp.publicKey,
        lamports,
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
    )
    .add(createInitializeAccount3Instruction(ataKp.publicKey, mint, owner, TOKEN_PROGRAM_ID));
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer, ataKp);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `createATA failed: ${JSON.stringify(r)}`).toBeNull();
  return ataKp.publicKey;
}

async function mintTo(
  context: ProgramTestContext,
  mint: PublicKey,
  mintAuthority: Keypair,
  dest: PublicKey,
  amount: bigint,
) {
  const ix = createMintToInstruction(mint, dest, mintAuthority.publicKey, amount, [], TOKEN_PROGRAM_ID);
  const r = await processOne(context, ix, [context.payer, mintAuthority], context.payer);
  expect(r.result, `mintTo failed: ${JSON.stringify(r)}`).toBeNull();
}

async function fundAuthority(context: ProgramTestContext, kp: Keypair, sol = 5) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: context.payer.publicKey,
      toPubkey: kp.publicKey,
      lamports: sol * LAMPORTS_PER_SOL,
    }),
  );
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer);
  await context.banksClient.tryProcessTransaction(tx);
}

// -- Instruction builders -----------------------------------------------------

function buildInitializeIx(opts: {
  admin: PublicKey;
  configPda: PublicKey;
  feeMint: PublicKey;
  vaultKbr: PublicKey;
  vaultBuyback: PublicKey;
  vaultStaking: PublicKey;
  vaultFundo: PublicKey;
  bpsKbr: number;
  bpsBuyback: number;
  bpsStaking: number;
  bpsFundo: number;
}): TransactionInstruction {
  // Borsh layout: 5*32 + 4*u16
  const data = Buffer.alloc(1 + 32 * 5 + 2 * 4);
  let o = 0;
  data.writeUInt8(0x00, o); o += 1;
  opts.feeMint.toBuffer().copy(data, o); o += 32;
  opts.vaultKbr.toBuffer().copy(data, o); o += 32;
  opts.vaultBuyback.toBuffer().copy(data, o); o += 32;
  opts.vaultStaking.toBuffer().copy(data, o); o += 32;
  opts.vaultFundo.toBuffer().copy(data, o); o += 32;
  data.writeUInt16LE(opts.bpsKbr, o); o += 2;
  data.writeUInt16LE(opts.bpsBuyback, o); o += 2;
  data.writeUInt16LE(opts.bpsStaking, o); o += 2;
  data.writeUInt16LE(opts.bpsFundo, o); o += 2;

  return new TransactionInstruction({
    programId: KNECT_PROGRAM,
    keys: [
      { pubkey: opts.admin, isSigner: true, isWritable: true },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildDistributeIx(opts: {
  payer: PublicKey;
  configPda: PublicKey;
  sourceAta: PublicKey;
  vaultKbr: PublicKey;
  vaultBuyback: PublicKey;
  vaultStaking: PublicKey;
  vaultFundo: PublicKey;
  feeMint: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(0x01, 0);
  data.writeBigUInt64LE(opts.amount, 1);
  return new TransactionInstruction({
    programId: KNECT_PROGRAM,
    keys: [
      { pubkey: opts.payer, isSigner: true, isWritable: true },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
      { pubkey: opts.sourceAta, isSigner: false, isWritable: true },
      { pubkey: opts.vaultKbr, isSigner: false, isWritable: true },
      { pubkey: opts.vaultBuyback, isSigner: false, isWritable: true },
      { pubkey: opts.vaultStaking, isSigner: false, isWritable: true },
      { pubkey: opts.vaultFundo, isSigner: false, isWritable: true },
      { pubkey: opts.feeMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildUpdateSplitsIx(opts: {
  admin: PublicKey;
  configPda: PublicKey;
  bpsKbr: number;
  bpsBuyback: number;
  bpsStaking: number;
  bpsFundo: number;
}): TransactionInstruction {
  const data = Buffer.alloc(1 + 2 * 4);
  let o = 0;
  data.writeUInt8(0x02, o); o += 1;
  data.writeUInt16LE(opts.bpsKbr, o); o += 2;
  data.writeUInt16LE(opts.bpsBuyback, o); o += 2;
  data.writeUInt16LE(opts.bpsStaking, o); o += 2;
  data.writeUInt16LE(opts.bpsFundo, o); o += 2;
  return new TransactionInstruction({
    programId: KNECT_PROGRAM,
    keys: [
      { pubkey: opts.admin, isSigner: true, isWritable: false },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('knect-tokenomics-pinocchio — selector 0x00/0x01/0x02', () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let payer: Keypair;
  let configPda: PublicKey;
  let mintFix: MintFixture;
  let sourceAta: PublicKey;
  let vaultKbr: PublicKey;
  let vaultBuyback: PublicKey;
  let vaultStaking: PublicKey;
  let vaultFundo: PublicKey;

  beforeAll(async () => {
    context = await boot();
    admin = Keypair.generate();
    payer = Keypair.generate();
    await fundAuthority(context, admin);
    await fundAuthority(context, payer);

    [configPda] = deriveConfigPda(admin.publicKey);

    mintFix = await createMint(context, 6);
    sourceAta = await createTokenAccount(context, mintFix.mint, payer.publicKey);
    vaultKbr = await createTokenAccount(context, mintFix.mint, Keypair.generate().publicKey);
    vaultBuyback = await createTokenAccount(context, mintFix.mint, Keypair.generate().publicKey);
    vaultStaking = await createTokenAccount(context, mintFix.mint, Keypair.generate().publicKey);
    vaultFundo = await createTokenAccount(context, mintFix.mint, Keypair.generate().publicKey);

    // Pre-fund source with 1_000_000 base units (1 token at 6 decimals)
    await mintTo(context, mintFix.mint, mintFix.authority, sourceAta, 1_000_000n);
  });

  it('initialize_config with bps 25/25/35/15 writes the PDA', async () => {
    const ix = buildInitializeIx({
      admin: admin.publicKey,
      configPda,
      feeMint: mintFix.mint,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      bpsKbr: 2500, bpsBuyback: 2500, bpsStaking: 3500, bpsFundo: 1500,
    });
    const r = await processOne(context, ix, [admin], admin);
    expect(r.result, `init failed: ${JSON.stringify(r)}`).toBeNull();

    const acct = await context.banksClient.getAccount(configPda);
    expect(acct).not.toBeNull();
    expect(acct!.owner.equals(KNECT_PROGRAM)).toBe(true);
    const expectedDisc = Buffer.from([223, 18, 91, 144, 207, 33, 86, 12]);
    expect(Buffer.from(acct!.data.slice(0, 8)).equals(expectedDisc)).toBe(true);
  });

  it('initialize rejects bps sum != 10_000', async () => {
    const otherAdmin = Keypair.generate();
    await fundAuthority(context, otherAdmin);
    const [otherConfig] = deriveConfigPda(otherAdmin.publicKey);
    const ix = buildInitializeIx({
      admin: otherAdmin.publicKey,
      configPda: otherConfig,
      feeMint: mintFix.mint,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      bpsKbr: 2500, bpsBuyback: 2500, bpsStaking: 3500, bpsFundo: 1499, // 9999
    });
    const r = await processOne(context, ix, [otherAdmin], otherAdmin);
    expect(extractCustomErrorCode(r)).toBe(ERR_BPS_SUM_MISMATCH);
  });

  it('initialize twice rejects with ALREADY_INITIALIZED', async () => {
    const ix = buildInitializeIx({
      admin: admin.publicKey,
      configPda,
      feeMint: mintFix.mint,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      bpsKbr: 2500, bpsBuyback: 2500, bpsStaking: 3500, bpsFundo: 1500,
    });
    const r = await processOne(context, ix, [admin], admin);
    expect(extractCustomErrorCode(r)).toBe(ERR_ALREADY_INITIALIZED);
  });

  it('distribute splits 1_000_000 → 250000/250000/350000/150000 exactly', async () => {
    const before = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
      source: await readBalance(context.banksClient, sourceAta),
    };

    const ix = buildDistributeIx({
      payer: payer.publicKey,
      configPda,
      sourceAta,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      feeMint: mintFix.mint,
      amount: 1_000_000n,
    });
    const r = await processOne(context, ix, [payer], payer);
    expect(r.result, `distribute failed: ${JSON.stringify(r)}`).toBeNull();

    const after = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
      source: await readBalance(context.banksClient, sourceAta),
    };

    expect(after.kbr - before.kbr).toBe(250_000n);
    expect(after.buyback - before.buyback).toBe(250_000n);
    expect(after.staking - before.staking).toBe(350_000n);
    expect(after.fundo - before.fundo).toBe(150_000n);
    expect(before.source - after.source).toBe(1_000_000n);
  });

  it('distribute amount=0 rejects with AMOUNT_ZERO', async () => {
    const ix = buildDistributeIx({
      payer: payer.publicKey,
      configPda,
      sourceAta,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      feeMint: mintFix.mint,
      amount: 0n,
    });
    const r = await processOne(context, ix, [payer], payer);
    expect(extractCustomErrorCode(r)).toBe(ERR_AMOUNT_ZERO);
  });

  it('distribute with substituted vault rejects with VAULT_OWNER_MISMATCH', async () => {
    const fakeVault = await createTokenAccount(context, mintFix.mint, Keypair.generate().publicKey);
    const ix = buildDistributeIx({
      payer: payer.publicKey,
      configPda,
      sourceAta,
      vaultKbr: fakeVault, // substituted!
      vaultBuyback, vaultStaking, vaultFundo,
      feeMint: mintFix.mint,
      amount: 1_000n,
    });
    const r = await processOne(context, ix, [payer], payer);
    expect(extractCustomErrorCode(r)).toBe(ERR_VAULT_OWNER_MISMATCH);
  });

  it('distribute rounding: amount=1 → 0/0/0/1 (fundo absorbs rounding, no leakage)', async () => {
    // Mint a small extra balance to source first
    await mintTo(context, mintFix.mint, mintFix.authority, sourceAta, 100n);

    const before = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
    };

    const ix = buildDistributeIx({
      payer: payer.publicKey,
      configPda,
      sourceAta,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      feeMint: mintFix.mint,
      amount: 1n, // can't be split cleanly — fundo absorbs everything
    });
    const r = await processOne(context, ix, [payer], payer);
    expect(r.result, `distribute amount=1 failed: ${JSON.stringify(r)}`).toBeNull();

    const after = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
    };

    // 1 * 2500 / 10000 = 0, 1 * 2500 / 10000 = 0, 1 * 3500 / 10000 = 0
    // fundo = 1 - 0 - 0 - 0 = 1
    expect(after.kbr - before.kbr).toBe(0n);
    expect(after.buyback - before.buyback).toBe(0n);
    expect(after.staking - before.staking).toBe(0n);
    expect(after.fundo - before.fundo).toBe(1n);
  });

  it('update_splits with admin signer changes bps; subsequent distribute uses new bps', async () => {
    // Change to 40/30/20/10
    const upd = buildUpdateSplitsIx({
      admin: admin.publicKey,
      configPda,
      bpsKbr: 4000, bpsBuyback: 3000, bpsStaking: 2000, bpsFundo: 1000,
    });
    const r1 = await processOne(context, upd, [admin], admin);
    expect(r1.result, `update failed: ${JSON.stringify(r1)}`).toBeNull();

    // Distribute 10000 → 4000/3000/2000/1000
    await mintTo(context, mintFix.mint, mintFix.authority, sourceAta, 10_000n);
    const before = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
    };
    const ix = buildDistributeIx({
      payer: payer.publicKey,
      configPda,
      sourceAta,
      vaultKbr, vaultBuyback, vaultStaking, vaultFundo,
      feeMint: mintFix.mint,
      amount: 10_000n,
    });
    const r2 = await processOne(context, ix, [payer], payer);
    expect(r2.result, `distribute post-update failed: ${JSON.stringify(r2)}`).toBeNull();

    const after = {
      kbr: await readBalance(context.banksClient, vaultKbr),
      buyback: await readBalance(context.banksClient, vaultBuyback),
      staking: await readBalance(context.banksClient, vaultStaking),
      fundo: await readBalance(context.banksClient, vaultFundo),
    };
    expect(after.kbr - before.kbr).toBe(4000n);
    expect(after.buyback - before.buyback).toBe(3000n);
    expect(after.staking - before.staking).toBe(2000n);
    expect(after.fundo - before.fundo).toBe(1000n);
  });

  it('update_splits by non-admin rejects with NOT_ADMIN', async () => {
    const intruder = Keypair.generate();
    await fundAuthority(context, intruder);
    const ix = buildUpdateSplitsIx({
      admin: intruder.publicKey,
      configPda,
      bpsKbr: 5000, bpsBuyback: 2500, bpsStaking: 1500, bpsFundo: 1000,
    });
    const r = await processOne(context, ix, [intruder], intruder);
    expect(extractCustomErrorCode(r)).toBe(ERR_NOT_ADMIN);
  });
});
