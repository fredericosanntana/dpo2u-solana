/**
 * Sprint Continuable round 2 — agent-registry runtime tests (2026-05-15).
 *
 * Covers the two new instructions added 2026-05-15:
 *   - `register_mcp_server` — IMDA MGF-Agentic MCP whitelist
 *     (now ADMIN_PUBKEY-gated, audit SOL-H003 fix)
 *   - `revoke_mcp_server` — only the original authority can revoke
 *   - `register_value_chain_node` — 5-role MGF-Agentic + Kenney taxonomy
 *
 * Pattern mirrors tests/consent-manager-runtime.test.ts + tests/spl-token-cpi.test.ts
 * (admin-keypair loader copied from spl-token-cpi.test.ts).
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

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
import { BorshCoder, BN } from '@coral-xyz/anchor';

import idl from '../target/idl/agent_registry.json' assert { type: 'json' };
import { PROGRAM_IDS } from './helpers.js';

const REPO_ROOT = path.resolve(__dirname, '../../');
const ADMIN_PUBKEY = new PublicKey('HjpGXPWQF1PiqjdWtNNEbAxqNamXKGpJspRZm9Jv5LZj');

// -- Admin keypair loader (copied from tests/spl-token-cpi.test.ts) ------------
// register_mcp_server is now address-gated to ADMIN_PUBKEY (audit SOL-H003).
// We need the actual on-chain admin keypair to sign; load from ~/.config/solana
// (CI) or from env ADMIN_KEYPAIR. Tests requiring admin are skipped if absent.
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

function deriveMcpServerPda(authority: PublicKey, mcpPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mcp_server'), authority.toBuffer(), mcpPubkey.toBuffer()],
    PROGRAM_IDS.agent_registry,
  );
}

function deriveValueChainPda(
  authority: PublicKey,
  agentId: Buffer,
  role: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('value_chain'), authority.toBuffer(), agentId, Buffer.from([role])],
    PROGRAM_IDS.agent_registry,
  );
}

// -- Fixtures ------------------------------------------------------------------

const coder = new BorshCoder(idl as any);

function jurisdiction16(code: string): number[] {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return Array.from(buf);
}

function buildRegisterMcpIx(authority: PublicKey, mcpPubkey: PublicKey): TransactionInstruction {
  const data = coder.instruction.encode('register_mcp_server', {
    mcp_pubkey: mcpPubkey,
    name: 'dpo2u-mcp-prod',
    compliance_hash: Array.from(Buffer.alloc(32, 1)),
    jurisdictions_supported: [jurisdiction16('LGPD'), jurisdiction16('GDPR')],
    audit_date: new BN(1_700_000_000),
    audit_uri: 'ipfs://QmAuditBundle/dpo2u-mcp',
  });
  const [pda] = deriveMcpServerPda(authority, mcpPubkey);
  return new TransactionInstruction({
    programId: PROGRAM_IDS.agent_registry,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildRevokeMcpIx(authority: PublicKey, mcpPda: PublicKey): TransactionInstruction {
  const data = coder.instruction.encode('revoke_mcp_server', { reason_code: 1001 });
  return new TransactionInstruction({
    programId: PROGRAM_IDS.agent_registry,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: mcpPda, isSigner: false, isWritable: true },
    ],
    data,
  });
}

function buildRegisterValueChainIx(args: {
  authority: PublicKey;
  agentId: Buffer;
  role: number;
  parent: PublicKey | null;
  jurisdiction: string;
  contractUri: string;
}): TransactionInstruction {
  const data = coder.instruction.encode('register_value_chain_node', {
    agent_id: Array.from(args.agentId),
    role: args.role,
    parent: args.parent, // Anchor IDL Option<Pubkey>: null | PublicKey, BorshCoder encodes the tag
    jurisdiction: jurisdiction16(args.jurisdiction),
    contract_uri: args.contractUri,
  });
  const [pda] = deriveValueChainPda(args.authority, args.agentId, args.role);
  return new TransactionInstruction({
    programId: PROGRAM_IDS.agent_registry,
    keys: [
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// =============================================================================
// register_mcp_server — admin-gated (audit SOL-H003)
// =============================================================================

describe('agent-registry — register_mcp_server (admin-gated)', () => {
  it.skipIf(!loadAdminKeypair())(
    'happy path — ADMIN_PUBKEY signer publishes whitelist entry',
    async () => {
      const admin = loadAdminKeypair()!;
      expect(admin.publicKey.toBase58()).toBe(ADMIN_PUBKEY.toBase58());

      const context = await boot([adminAccount(admin.publicKey)]);
      const mcpKey = Keypair.generate().publicKey;

      const ix = buildRegisterMcpIx(admin.publicKey, mcpKey);
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);

      const r = await context.banksClient.tryProcessTransaction(tx);
      expect(r.result, `register_mcp_server failed: ${JSON.stringify(r)}`).toBeNull();

      const [pda] = deriveMcpServerPda(admin.publicKey, mcpKey);
      const acc = await context.banksClient.getAccount(pda);
      expect(acc, 'mcp_server PDA must exist').toBeTruthy();

      const decoded = coder.accounts.decode('McpServer', Buffer.from(acc!.data));
      expect(decoded.authority.toBase58()).toBe(admin.publicKey.toBase58());
      expect(decoded.mcp_pubkey.toBase58()).toBe(mcpKey.toBase58());
      expect(decoded.name).toBe('dpo2u-mcp-prod');
      expect(decoded.jurisdictions_supported).toHaveLength(2);
      expect(decoded.revoked_at).toBeNull();
    },
    60_000,
  );

  it('rejects non-admin signer with UnauthorizedAdmin (audit SOL-H003)', async () => {
    const context = await boot();
    // payer is NOT ADMIN_PUBKEY — anchor `address` constraint must fail.
    const fauxAuthority = context.payer;
    const mcpKey = Keypair.generate().publicKey;

    // We deliberately build the ix with the wrong signer pubkey in the accounts
    // list. Anchor's address-equals constraint compares the signer's actual key
    // to ADMIN_PUBKEY at runtime and rejects.
    const ix = buildRegisterMcpIx(fauxAuthority.publicKey, mcpKey);
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = fauxAuthority.publicKey;
    tx.sign(fauxAuthority);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'must reject non-admin').not.toBeNull();
    // Anchor address-mismatch surfaces as ConstraintAddress (2012) or the
    // custom error code we mapped (UnauthorizedAdmin = 6002 in this IDL).
    // Either is acceptable; we just assert failure.
  }, 60_000);
});

// =============================================================================
// revoke_mcp_server — only original authority
// =============================================================================

describe('agent-registry — revoke_mcp_server (authority-gated)', () => {
  it.skipIf(!loadAdminKeypair())(
    'rejects revoke when a different authority signs',
    async () => {
      const admin = loadAdminKeypair()!;
      const context = await boot([adminAccount(admin.publicKey)]);

      // Step 1: admin creates the MCP whitelist entry.
      const mcpKey = Keypair.generate().publicKey;
      {
        const ix = buildRegisterMcpIx(admin.publicKey, mcpKey);
        const tx = new Transaction().add(ix);
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const r = await context.banksClient.tryProcessTransaction(tx);
        expect(r.result, `prep register failed: ${JSON.stringify(r)}`).toBeNull();
      }

      // Step 2: a DIFFERENT keypair tries to revoke — must fail.
      const stranger = Keypair.generate();
      // fund stranger
      {
        const ix = SystemProgram.transfer({
          fromPubkey: context.payer.publicKey,
          toPubkey: stranger.publicKey,
          lamports: 1 * LAMPORTS_PER_SOL,
        });
        const tx = new Transaction().add(ix);
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = context.payer.publicKey;
        tx.sign(context.payer);
        await context.banksClient.tryProcessTransaction(tx);
      }

      const [mcpPda] = deriveMcpServerPda(admin.publicKey, mcpKey);
      const ix = buildRevokeMcpIx(stranger.publicKey, mcpPda);
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = stranger.publicKey;
      tx.sign(stranger);

      const r = await context.banksClient.tryProcessTransaction(tx);
      expect(r.result, 'stranger revoke must fail').not.toBeNull();
    },
    60_000,
  );
});

// =============================================================================
// register_value_chain_node — 5 roles, optional parent, role validation
// =============================================================================

describe('agent-registry — register_value_chain_node', () => {
  // 1=ModelDev 2=ToolProvider 3=AgenticProvider 4=DeployingOrg 5=EndUser
  const ROLES = [1, 2, 3, 4, 5] as const;

  it('each role 1..=5 yields a distinct PDA for the same (authority, agent_id)', () => {
    const authority = Keypair.generate().publicKey;
    const agentId = Buffer.alloc(32, 0xab);

    const pdas = ROLES.map((r) => deriveValueChainPda(authority, agentId, r)[0].toBase58());
    expect(new Set(pdas).size).toBe(5);
  });

  it('happy path — role 3 (AgenticProvider) with NO parent succeeds', async () => {
    const context = await boot();
    const authority = context.payer;
    const agentId = Buffer.from(
      'aa'.repeat(32), // 32 bytes
      'hex',
    );

    const ix = buildRegisterValueChainIx({
      authority: authority.publicKey,
      agentId,
      role: 3,
      parent: null,
      jurisdiction: 'GDPR',
      contractUri: 'ipfs://QmContract/agentic-provider',
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `tx failed: ${JSON.stringify(r)}`).toBeNull();

    const [pda] = deriveValueChainPda(authority.publicKey, agentId, 3);
    const acc = await context.banksClient.getAccount(pda);
    expect(acc).toBeTruthy();
    const decoded = coder.accounts.decode('ValueChainNode', Buffer.from(acc!.data));
    expect(decoded.role).toBe(3);
    expect(decoded.parent).toBeNull();
    expect(decoded.contract_uri).toBe('ipfs://QmContract/agentic-provider');
  }, 60_000);

  it('happy path — Option<Pubkey> parent serializes correctly (role 4, parent=role 3 PDA)', async () => {
    const context = await boot();
    const authority = context.payer;
    const agentId = Buffer.from('bb'.repeat(32), 'hex');

    // Step 1: register the parent node (role 3, AgenticProvider).
    {
      const ix = buildRegisterValueChainIx({
        authority: authority.publicKey,
        agentId,
        role: 3,
        parent: null,
        jurisdiction: 'EU-AIA',
        contractUri: '',
      });
      const tx = new Transaction().add(ix);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = authority.publicKey;
      tx.sign(authority);
      const r = await context.banksClient.tryProcessTransaction(tx);
      expect(r.result, `parent register failed: ${JSON.stringify(r)}`).toBeNull();
    }

    // Step 2: register child node (role 4, DeployingOrg) with parent=PDA-of-role-3.
    const [parentPda] = deriveValueChainPda(authority.publicKey, agentId, 3);
    const ix = buildRegisterValueChainIx({
      authority: authority.publicKey,
      agentId,
      role: 4,
      parent: parentPda,
      jurisdiction: 'EU-AIA',
      contractUri: 'ipfs://QmContract/deploying-org',
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);
    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, `child register failed: ${JSON.stringify(r)}`).toBeNull();

    const [childPda] = deriveValueChainPda(authority.publicKey, agentId, 4);
    const acc = await context.banksClient.getAccount(childPda);
    expect(acc).toBeTruthy();
    const decoded = coder.accounts.decode('ValueChainNode', Buffer.from(acc!.data));
    expect(decoded.role).toBe(4);
    expect(decoded.parent).not.toBeNull();
    expect(decoded.parent.toBase58()).toBe(parentPda.toBase58());
  }, 60_000);

  it('rejects role=0 (InvalidRole)', async () => {
    const context = await boot();
    const authority = context.payer;
    const agentId = Buffer.from('cc'.repeat(32), 'hex');

    const ix = buildRegisterValueChainIx({
      authority: authority.publicKey,
      agentId,
      role: 0,
      parent: null,
      jurisdiction: 'LGPD',
      contractUri: '',
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'role=0 must be rejected').not.toBeNull();
  }, 60_000);

  it('rejects role=6 (InvalidRole — only 1..=5 valid)', async () => {
    const context = await boot();
    const authority = context.payer;
    const agentId = Buffer.from('dd'.repeat(32), 'hex');

    const ix = buildRegisterValueChainIx({
      authority: authority.publicKey,
      agentId,
      role: 6,
      parent: null,
      jurisdiction: 'LGPD',
      contractUri: '',
    });
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = authority.publicKey;
    tx.sign(authority);

    const r = await context.banksClient.tryProcessTransaction(tx);
    expect(r.result, 'role=6 must be rejected').not.toBeNull();
  }, 60_000);
});
