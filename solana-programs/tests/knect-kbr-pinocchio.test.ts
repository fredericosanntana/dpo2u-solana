/**
 * knect-kbr-pinocchio — bankrun integration tests (KNECT WP v2.1 §05).
 *
 * Proves the sovereign-redemption mechanism:
 *   - initialize_kbr writes the config PDA + rejects fee_bps > cap
 *   - deposit_reserve moves cbBTC into the PDA-owned vault
 *   - redeem: exact gross/fee/net arithmetic, KNECT burned, supply decremented,
 *     fee retained, and the KBR ratio of the REMAINDER strictly rises
 *   - redeem reverts on amount=0, amount>supply, substituted vault
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
  MintLayout,
} from '@solana/spl-token';

const REPO_ROOT = path.resolve(__dirname, '../../');
const KBR_PROGRAM = new PublicKey('2KjMGtciVcoWVJ6qUjkwupixUWW8kyvRNSpDdgAWeXd9');

// err codes from src/lib.rs `mod err`
const ERR_VAULT_MISMATCH = 0x5004;
const ERR_AMOUNT_ZERO = 0x5006;
const ERR_ALREADY_INITIALIZED = 0x5008;
const ERR_FEE_TOO_HIGH = 0x500b;
const ERR_SUPPLY_EXCEEDED = 0x500c;

const FEE_BPS = 100; // 1%
const KNECT_SUPPLY = 1_000_000n; // config denominator
const DEPOSIT = 1_000_000n; // cbBTC base units → ratio starts at 1.0
const HOLDER_KNECT = 100_000n;

function deriveConfigPda(admin: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('kbr_config'), admin.toBuffer()], KBR_PROGRAM);
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
    const f = tryFromString(s);
    if (f !== null) return f;
  }
  for (const line of (result?.meta?.logMessages ?? []) as string[]) {
    const f = tryFromString(line);
    if (f !== null) return f;
  }
  return null;
}

async function readBalance(client: BanksClient, ata: PublicKey): Promise<bigint> {
  const acc = await client.getAccount(ata);
  if (!acc) return 0n;
  return AccountLayout.decode(Buffer.from(acc.data)).amount;
}

async function readMintSupply(client: BanksClient, mint: PublicKey): Promise<bigint> {
  const acc = await client.getAccount(mint);
  if (!acc) return 0n;
  return MintLayout.decode(Buffer.from(acc.data)).supply;
}

interface KbrConfigView {
  feeBps: number;
  knectSupply: bigint;
  btcInVault: bigint;
}

async function readConfig(client: BanksClient, configPda: PublicKey): Promise<KbrConfigView> {
  const acc = await client.getAccount(configPda);
  if (!acc) throw new Error('config not found');
  const d = Buffer.from(acc.data);
  // 8 disc + 4 pubkeys(128) = 136; fee_bps u16 @136; knect_supply u64 @138; btc_in_vault u64 @146
  return {
    feeBps: d.readUInt16LE(136),
    knectSupply: d.readBigUInt64LE(138),
    btcInVault: d.readBigUInt64LE(146),
  };
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

async function fund(context: ProgramTestContext, kp: Keypair, sol = 5) {
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

async function createMint(context: ProgramTestContext, decimals: number): Promise<{ mint: PublicKey; authority: Keypair }> {
  const mintKp = Keypair.generate();
  const authority = Keypair.generate();
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));
  const tx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: context.payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }))
    .add(createInitializeMint2Instruction(mintKp.publicKey, decimals, authority.publicKey, null, TOKEN_PROGRAM_ID));
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer, mintKp);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `createMint failed: ${JSON.stringify(r)}`).toBeNull();
  return { mint: mintKp.publicKey, authority };
}

async function createAta(context: ProgramTestContext, mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const ataKp = Keypair.generate();
  const rent = await context.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(ACCOUNT_SIZE)));
  const tx = new Transaction()
    .add(SystemProgram.createAccount({
      fromPubkey: context.payer.publicKey,
      newAccountPubkey: ataKp.publicKey,
      lamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }))
    .add(createInitializeAccount3Instruction(ataKp.publicKey, mint, owner, TOKEN_PROGRAM_ID));
  tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())[0]!;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer, ataKp);
  const r = await context.banksClient.tryProcessTransaction(tx);
  expect(r.result, `createAta failed: ${JSON.stringify(r)}`).toBeNull();
  return ataKp.publicKey;
}

async function mintTo(context: ProgramTestContext, mint: PublicKey, authority: Keypair, dest: PublicKey, amount: bigint) {
  const ix = createMintToInstruction(mint, dest, authority.publicKey, amount, [], TOKEN_PROGRAM_ID);
  const r = await processOne(context, ix, [context.payer, authority], context.payer);
  expect(r.result, `mintTo failed: ${JSON.stringify(r)}`).toBeNull();
}

function u64le(n: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b; }

function buildInitIx(opts: {
  admin: PublicKey; configPda: PublicKey; cbbtcMint: PublicKey; knectMint: PublicKey;
  vault: PublicKey; feeBps: number; supply: bigint;
}): TransactionInstruction {
  const feeBuf = Buffer.alloc(2); feeBuf.writeUInt16LE(opts.feeBps, 0);
  const data = Buffer.concat([
    Buffer.from([0x00]),
    opts.cbbtcMint.toBuffer(), opts.knectMint.toBuffer(), opts.vault.toBuffer(),
    feeBuf, u64le(opts.supply),
  ]);
  return new TransactionInstruction({
    programId: KBR_PROGRAM,
    keys: [
      { pubkey: opts.admin, isSigner: true, isWritable: true },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildDepositIx(opts: {
  depositor: PublicKey; configPda: PublicKey; source: PublicKey; vault: PublicKey;
  cbbtcMint: PublicKey; amount: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: KBR_PROGRAM,
    keys: [
      { pubkey: opts.depositor, isSigner: true, isWritable: true },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
      { pubkey: opts.source, isSigner: false, isWritable: true },
      { pubkey: opts.vault, isSigner: false, isWritable: true },
      { pubkey: opts.cbbtcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([0x01]), u64le(opts.amount)]),
  });
}

function buildRedeemIx(opts: {
  holder: PublicKey; configPda: PublicKey; knectMint: PublicKey; holderKnect: PublicKey;
  vault: PublicKey; holderCbbtc: PublicKey; cbbtcMint: PublicKey; knectAmount: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: KBR_PROGRAM,
    keys: [
      { pubkey: opts.holder, isSigner: true, isWritable: true },
      { pubkey: opts.configPda, isSigner: false, isWritable: true },
      { pubkey: opts.knectMint, isSigner: false, isWritable: true },
      { pubkey: opts.holderKnect, isSigner: false, isWritable: true },
      { pubkey: opts.vault, isSigner: false, isWritable: true },
      { pubkey: opts.holderCbbtc, isSigner: false, isWritable: true },
      { pubkey: opts.cbbtcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([0x02]), u64le(opts.knectAmount)]),
  });
}

describe('knect-kbr-pinocchio — selector 0x00/0x01/0x02', () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let holder: Keypair;
  let configPda: PublicKey;
  let cbbtcMint: PublicKey;
  let cbbtcAuth: Keypair;
  let knectMint: PublicKey;
  let knectAuth: Keypair;
  let vault: PublicKey;
  let depositorSource: PublicKey;
  let holderCbbtc: PublicKey;
  let holderKnect: PublicKey;

  beforeAll(async () => {
    context = await startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], []);
    admin = Keypair.generate();
    holder = Keypair.generate();
    await fund(context, admin);
    await fund(context, holder);
    [configPda] = deriveConfigPda(admin.publicKey);

    ({ mint: cbbtcMint, authority: cbbtcAuth } = await createMint(context, 8)); // BTC-like
    ({ mint: knectMint, authority: knectAuth } = await createMint(context, 6));

    vault = await createAta(context, cbbtcMint, configPda); // vault owned by config PDA
    depositorSource = await createAta(context, cbbtcMint, admin.publicKey);
    holderCbbtc = await createAta(context, cbbtcMint, holder.publicKey);
    holderKnect = await createAta(context, knectMint, holder.publicKey);

    await mintTo(context, cbbtcMint, cbbtcAuth, depositorSource, DEPOSIT);
    await mintTo(context, knectMint, knectAuth, holderKnect, HOLDER_KNECT);
  });

  it('initialize_kbr writes the config PDA', async () => {
    const ix = buildInitIx({
      admin: admin.publicKey, configPda, cbbtcMint, knectMint, vault,
      feeBps: FEE_BPS, supply: KNECT_SUPPLY,
    });
    const r = await processOne(context, ix, [admin], admin);
    expect(r.result, `init failed: ${JSON.stringify(r)}`).toBeNull();

    const acct = await context.banksClient.getAccount(configPda);
    expect(acct).not.toBeNull();
    expect(acct!.owner.equals(KBR_PROGRAM)).toBe(true);
    const disc = Buffer.from([0x41, 0x0a, 0xde, 0x41, 0xce, 0xe1, 0x2f, 0x36]);
    expect(Buffer.from(acct!.data.slice(0, 8)).equals(disc)).toBe(true);
    const cfg = await readConfig(context.banksClient, configPda);
    expect(cfg.feeBps).toBe(FEE_BPS);
    expect(cfg.knectSupply).toBe(KNECT_SUPPLY);
  });

  it('initialize rejects fee_bps above the cap', async () => {
    const other = Keypair.generate();
    await fund(context, other);
    const [otherCfg] = deriveConfigPda(other.publicKey);
    const ix = buildInitIx({
      admin: other.publicKey, configPda: otherCfg, cbbtcMint, knectMint, vault,
      feeBps: 1001, supply: KNECT_SUPPLY,
    });
    const r = await processOne(context, ix, [other], other);
    expect(extractCustomErrorCode(r)).toBe(ERR_FEE_TOO_HIGH);
  });

  it('initialize twice rejects with ALREADY_INITIALIZED', async () => {
    const ix = buildInitIx({
      admin: admin.publicKey, configPda, cbbtcMint, knectMint, vault,
      feeBps: FEE_BPS, supply: KNECT_SUPPLY,
    });
    const r = await processOne(context, ix, [admin], admin);
    expect(extractCustomErrorCode(r)).toBe(ERR_ALREADY_INITIALIZED);
  });

  it('deposit_reserve moves cbBTC into the vault', async () => {
    const ix = buildDepositIx({
      depositor: admin.publicKey, configPda, source: depositorSource, vault, cbbtcMint, amount: DEPOSIT,
    });
    const r = await processOne(context, ix, [admin], admin);
    expect(r.result, `deposit failed: ${JSON.stringify(r)}`).toBeNull();
    expect(await readBalance(context.banksClient, vault)).toBe(DEPOSIT);
    const cfg = await readConfig(context.banksClient, configPda);
    expect(cfg.btcInVault).toBe(DEPOSIT);
  });

  it('redeem: exact net/fee, burn, supply down, and the KBR ratio RISES', async () => {
    const before = await readConfig(context.banksClient, configPda);
    const ratioBefore = Number(before.btcInVault) / Number(before.knectSupply);
    const knectSupplyBefore = await readMintSupply(context.banksClient, knectMint);

    const ix = buildRedeemIx({
      holder: holder.publicKey, configPda, knectMint, holderKnect, vault, holderCbbtc, cbbtcMint,
      knectAmount: HOLDER_KNECT, // 100_000 of 1_000_000 supply = 10%
    });
    const r = await processOne(context, ix, [holder], holder);
    expect(r.result, `redeem failed: ${JSON.stringify(r)}`).toBeNull();

    // gross = 100_000 * 1_000_000 / 1_000_000 = 100_000; fee 1% = 1_000; net = 99_000
    expect(await readBalance(context.banksClient, holderCbbtc)).toBe(99_000n);
    expect(await readBalance(context.banksClient, vault)).toBe(DEPOSIT - 99_000n); // 901_000
    expect(await readBalance(context.banksClient, holderKnect)).toBe(0n); // burned

    // KNECT mint supply dropped by the burned amount
    expect(knectSupplyBefore - (await readMintSupply(context.banksClient, knectMint))).toBe(HOLDER_KNECT);

    const after = await readConfig(context.banksClient, configPda);
    expect(after.knectSupply).toBe(900_000n);
    expect(after.btcInVault).toBe(901_000n);

    const ratioAfter = Number(after.btcInVault) / Number(after.knectSupply);
    expect(ratioAfter).toBeGreaterThan(ratioBefore); // floor of the remainder rose
  });

  it('redeem amount=0 rejects with AMOUNT_ZERO', async () => {
    const ix = buildRedeemIx({
      holder: holder.publicKey, configPda, knectMint, holderKnect, vault, holderCbbtc, cbbtcMint,
      knectAmount: 0n,
    });
    const r = await processOne(context, ix, [holder], holder);
    expect(extractCustomErrorCode(r)).toBe(ERR_AMOUNT_ZERO);
  });

  it('redeem amount > supply rejects with SUPPLY_EXCEEDED', async () => {
    const ix = buildRedeemIx({
      holder: holder.publicKey, configPda, knectMint, holderKnect, vault, holderCbbtc, cbbtcMint,
      knectAmount: 999_999_999n,
    });
    const r = await processOne(context, ix, [holder], holder);
    expect(extractCustomErrorCode(r)).toBe(ERR_SUPPLY_EXCEEDED);
  });

  it('redeem with substituted vault rejects with VAULT_MISMATCH', async () => {
    const fakeVault = await createAta(context, cbbtcMint, Keypair.generate().publicKey);
    const ix = buildRedeemIx({
      holder: holder.publicKey, configPda, knectMint, holderKnect, vault: fakeVault, holderCbbtc, cbbtcMint,
      knectAmount: 1_000n,
    });
    const r = await processOne(context, ix, [holder], holder);
    expect(extractCustomErrorCode(r)).toBe(ERR_VAULT_MISMATCH);
  });
});
