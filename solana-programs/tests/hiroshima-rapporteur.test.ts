/**
 * Sprint F + audit SOL-H002 — Hiroshima rapporteur authority runtime tests.
 *
 * Covers:
 *   - `initialize_rapporteur_config` — now ADMIN_PUBKEY-gated (SOL-H002 fix
 *     2026-05-15). Prevents first-caller-wins race that would let an attacker
 *     become the rapporteur authority.
 *   - `update_rapporteur_authority` — admin-only via require_keys_eq.
 *   - `flag_termination_obligation` — only the configured rapporteur_authority
 *     can sign. red_line_category bounded to 1..=12 (CAIDP-UG canonical range).
 *     TerminationOrder PDA is init-once per ai_system_id (irreversible).
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';
import { startAnchor, ProgramTestContext, AddedAccount } from 'solana-bankrun';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';

import idl from '../target/idl/hiroshima_ai_process_attestation.json' assert { type: 'json' };
import { PROGRAM_IDS } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');
const ADMIN_PUBKEY = new PublicKey('HjpGXPWQF1PiqjdWtNNEbAxqNamXKGpJspRZm9Jv5LZj');

// -- Admin keypair loader (mirrors tests/spl-token-cpi.test.ts) ----------------
function loadAdminKeypair(): Keypair | null {
  const p = process.env.ADMIN_KEYPAIR ?? path.join(os.homedir(), '.config/solana/id.json');
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(data));
}

function adminAccount(pubkey: PublicKey): AddedAccount {
  return {
    address: pubkey,
    info: {
      lamports: 10 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    },
  };
}

async function boot(extraAccounts: AddedAccount[] = []): Promise<ProgramTestContext> {
  return startAnchor(path.join(REPO_ROOT, 'solana-programs'), [], extraAccounts);
}

// -- PDA derivers --------------------------------------------------------------

function deriveRapporteurConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('rapporteur_config')],
    PROGRAM_IDS.hiroshima_ai_process_attestation,
  );
}

function deriveTerminationOrderPda(aiSystemId: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('termination_order'), aiSystemId],
    PROGRAM_IDS.hiroshima_ai_process_attestation,
  );
}

// -- Builders ------------------------------------------------------------------

const coder = new BorshCoder(idl as any);

function buildInitRapporteurIx(admin: PublicKey): TransactionInstruction {
  const data = coder.instruction.encode('initialize_rapporteur_config', {});
  const [cfgPda] = deriveRapporteurConfigPda();
  return new TransactionInstruction({
    programId: PROGRAM_IDS.hiroshima_ai_process_attestation,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: cfgPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildUpdateRapporteurAuthorityIx(
  admin: PublicKey,
  newAuthority: PublicKey,
): TransactionInstruction {
  const data = coder.instruction.encode('update_rapporteur_authority', {
    new_authority: newAuthority,
  });
  const [cfgPda] = deriveRapporteurConfigPda();
  return new TransactionInstruction({
    programId: PROGRAM_IDS.hiroshima_ai_process_attestation,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: cfgPda, isSigner: false, isWritable: true },
    ],
    data,
  });
}

function buildFlagTerminationIx(args: {
  rapporteur: PublicKey;
  aiSystemId: Buffer;
  reason: string;
  evidenceHash: Buffer;
  redLineCategory: number;
}): TransactionInstruction {
  const data = coder.instruction.encode('flag_termination_obligation', {
    ai_system_id: Array.from(args.aiSystemId),
    reason: args.reason,
    evidence_hash: Array.from(args.evidenceHash),
    red_line_category: args.redLineCategory,
  });
  const [cfgPda] = deriveRapporteurConfigPda();
  const [orderPda] = deriveTerminationOrderPda(args.aiSystemId);
  return new TransactionInstruction({
    programId: PROGRAM_IDS.hiroshima_ai_process_attestation,
    keys: [
      { pubkey: args.rapporteur, isSigner: true, isWritable: true },
      { pubkey: cfgPda, isSigner: false, isWritable: false },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function fund(context: ProgramTestContext, recipient: PublicKey, sol = 2): Promise<void> {
  const ix = SystemProgram.transfer({
    fromPubkey: context.payer.publicKey,
    toPubkey: recipient,
    lamports: sol * LAMPORTS_PER_SOL,
  });
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = context.lastBlockhash;
  tx.feePayer = context.payer.publicKey;
  tx.sign(context.payer);
  await context.banksClient.tryProcessTransaction(tx);
}

// =============================================================================
// initialize_rapporteur_config — admin-gated (audit SOL-H002 fix)
// =============================================================================

describe('hiroshima — initialize_rapporteur_config (admin-gated)', () => {
  it.skipIf(!loadAdminKeypair())(
    'happy path — ADMIN_PUBKEY signs and becomes admin + rapporteur_authority',
    async () => {
      const admin = loadAdminKeypair()!;
      expect(admin.publicKey.toBase58()).toBe(ADMIN_PUBKEY.toBase58());

      const context = await boot([adminAccount(admin.publicKey)]);
      const ix = buildInitRapporteurIx(admin.publicKey);
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);

      const r = await context.banksClient.tryProcessTransaction(tx);
      expect(r.result, `init failed: ${JSON.stringify(r)}`).toBeNull();

      const [cfgPda] = deriveRapporteurConfigPda();
      const acc = await context.banksClient.getAccount(cfgPda);
      expect(acc, 'rapporteur_config PDA must exist').toBeTruthy();
      const decoded = coder.accounts.decode('RapporteurConfig', Buffer.from(acc!.data));
      expect(decoded.admin.toBase58()).toBe(admin.publicKey.toBase58());
      expect(decoded.rapporteur_authority.toBase58()).toBe(admin.publicKey.toBase58());
      expect(decoded.version).toBe(1);
    },
    60_000,
  );

  it('rejects non-admin signer (audit SOL-H002 — prevents first-caller-wins race)', async () => {
    const context = await boot();
    // context.payer ≠ ADMIN_PUBKEY → address constraint must reject.
    const ix = buildInitRapporteurIx(context.payer.publicKey);
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = context.payer.publicKey;
    tx.sign(context.payer);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'non-admin init must fail').not.toBeNull();
  }, 60_000);
});

// =============================================================================
// update_rapporteur_authority — admin-only via require_keys_eq
// =============================================================================

describe('hiroshima — update_rapporteur_authority', () => {
  it.skipIf(!loadAdminKeypair())(
    'admin can update; non-admin signer is rejected with Unauthorized',
    async () => {
      const admin = loadAdminKeypair()!;
      const context = await boot([adminAccount(admin.publicKey)]);

      // Step 1: init the config so we have something to update.
      {
        const tx = new Transaction().add(buildInitRapporteurIx(admin.publicKey));
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, `init failed: ${JSON.stringify(r)}`).toBeNull();
      }

      // Step 2: stranger tries to update → must fail.
      const stranger = Keypair.generate();
      await fund(context, stranger.publicKey, 1);

      const newAuth = Keypair.generate().publicKey;
      {
        const tx = new Transaction().add(
          buildUpdateRapporteurAuthorityIx(stranger.publicKey, newAuth),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = stranger.publicKey;
        tx.sign(stranger);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, 'stranger update must fail').not.toBeNull();
      }

      // Step 3: admin updates successfully.
      {
        const tx = new Transaction().add(
          buildUpdateRapporteurAuthorityIx(admin.publicKey, newAuth),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, `admin update failed: ${JSON.stringify(r)}`).toBeNull();
      }

      const [cfgPda] = deriveRapporteurConfigPda();
      const acc = await context.banksClient.getAccount(cfgPda);
      const decoded = coder.accounts.decode('RapporteurConfig', Buffer.from(acc!.data));
      expect(decoded.rapporteur_authority.toBase58()).toBe(newAuth.toBase58());
    },
    60_000,
  );
});

// =============================================================================
// flag_termination_obligation — rapporteur-only, red_line bounded, init-once
// =============================================================================

describe('hiroshima — flag_termination_obligation', () => {
  it.skipIf(!loadAdminKeypair())(
    'rapporteur_authority can flag; PDA is init-once per ai_system_id',
    async () => {
      const admin = loadAdminKeypair()!;
      const context = await boot([adminAccount(admin.publicKey)]);

      // Init config (admin = rapporteur_authority).
      {
        const tx = new Transaction().add(buildInitRapporteurIx(admin.publicKey));
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, `init failed: ${JSON.stringify(r)}`).toBeNull();
      }

      const aiSystemId = createHash('sha256').update('ai-sys-frontier-mass-surveillance').digest();
      const evidenceHash = createHash('sha256').update('ipfs://QmRedLineEvidence').digest();

      // Flag #1 — must succeed.
      {
        const tx = new Transaction().add(
          buildFlagTerminationIx({
            rapporteur: admin.publicKey,
            aiSystemId,
            reason: 'red-line crossed: mass biometric surveillance in public space',
            evidenceHash,
            redLineCategory: 3,
          }),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, `flag failed: ${JSON.stringify(r)}`).toBeNull();

        const [orderPda] = deriveTerminationOrderPda(aiSystemId);
        const acc = await context.banksClient.getAccount(orderPda);
        expect(acc, 'termination_order PDA must exist').toBeTruthy();
        const decoded = coder.accounts.decode('TerminationOrder', Buffer.from(acc!.data));
        expect(decoded.red_line_category).toBe(3);
        expect(decoded.ordered_by.toBase58()).toBe(admin.publicKey.toBase58());
      }

      // Flag #2 — same ai_system_id → init constraint rejects (PDA already in use).
      {
        const tx = new Transaction().add(
          buildFlagTerminationIx({
            rapporteur: admin.publicKey,
            aiSystemId, // same
            reason: 'second attempt',
            evidenceHash,
            redLineCategory: 4,
          }),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, 'second flag on same ai_system_id must fail (init-once)').not.toBeNull();
      }
    },
    60_000,
  );

  it.skipIf(!loadAdminKeypair())(
    'rejects non-rapporteur signer with Unauthorized',
    async () => {
      const admin = loadAdminKeypair()!;
      const context = await boot([adminAccount(admin.publicKey)]);

      // Init config so cfg.rapporteur_authority = admin.
      {
        const tx = new Transaction().add(buildInitRapporteurIx(admin.publicKey));
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        await context.banksClient.tryProcessTransaction(tx);
      }

      const stranger = Keypair.generate();
      await fund(context, stranger.publicKey, 2);

      const aiSystemId = createHash('sha256').update('ai-sys-x').digest();
      const ix = buildFlagTerminationIx({
        rapporteur: stranger.publicKey,
        aiSystemId,
        reason: 'unauthorized attempt',
        evidenceHash: Buffer.alloc(32, 0),
        redLineCategory: 1,
      });
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = stranger.publicKey;
      tx.sign(stranger);
      const r = await context.banksClient.tryProcessTransaction(tx);
      expect(r.result, 'non-rapporteur flag must fail').not.toBeNull();
    },
    60_000,
  );

  it.skipIf(!loadAdminKeypair())(
    'rejects red_line_category=0 and >12 (CAIDP-UG canonical 1..=12)',
    async () => {
      const admin = loadAdminKeypair()!;
      const context = await boot([adminAccount(admin.publicKey)]);
      {
        const tx = new Transaction().add(buildInitRapporteurIx(admin.publicKey));
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        await context.banksClient.tryProcessTransaction(tx);
      }

      // category = 0 → InvalidRedLineCategory.
      {
        const aiSystemId = createHash('sha256').update('ai-cat0').digest();
        const tx = new Transaction().add(
          buildFlagTerminationIx({
            rapporteur: admin.publicKey,
            aiSystemId,
            reason: 'cat 0 attempt',
            evidenceHash: Buffer.alloc(32, 0),
            redLineCategory: 0,
          }),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, 'category=0 must be rejected').not.toBeNull();
      }

      // category = 13 → InvalidRedLineCategory.
      {
        const aiSystemId = createHash('sha256').update('ai-cat13').digest();
        const tx = new Transaction().add(
          buildFlagTerminationIx({
            rapporteur: admin.publicKey,
            aiSystemId,
            reason: 'cat 13 attempt',
            evidenceHash: Buffer.alloc(32, 0),
            redLineCategory: 13,
          }),
        );
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, 'category=13 must be rejected').not.toBeNull();
      }
    },
    60_000,
  );
});
