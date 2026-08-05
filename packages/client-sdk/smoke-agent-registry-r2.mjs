/**
 * Smoke — agent_registry Round 2 (deployed tx 4X8GcKcDb6Rv…dpnS 2026-05-15).
 *
 * Exercises the 3 new on-chain instructions live on devnet:
 *   1. register_mcp_server          → PDA + McpServerRegistered event
 *   2. register_value_chain_node    → PDA + ValueChainNodeRegistered event (DAG root)
 *   3. register_value_chain_node    → PDA chained from root (parent set)
 *   4. revoke_mcp_server            → McpServerRevoked event
 *
 * Each tx is captured + Explorer URL emitted so the run is auditable.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import anchorPkg from '@coral-xyz/anchor';
const { BorshCoder, BN } = anchorPkg;

const RPC = 'https://api.devnet.solana.com';
const AGENT_REGISTRY_PROGRAM_ID = new PublicKey(
  '5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7',
);

const idl = JSON.parse(
  fs.readFileSync('./dist/idl/agent_registry.json', 'utf-8'),
);
const coder = new BorshCoder(idl);
const connection = new Connection(RPC, 'confirmed');

const authority = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))),
);

const sha256 = (s) => new Uint8Array(crypto.createHash('sha256').update(s).digest());

const jurisdictionBytes = (code) => {
  const buf = Buffer.alloc(16);
  Buffer.from(code, 'ascii').copy(buf);
  return new Uint8Array(buf);
};

const explorerUrl = (sig) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function sendIx(ix) {
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return sendAndConfirmTransaction(connection, tx, [authority]);
}

async function main() {
  console.log('Authority:', authority.publicKey.toBase58());
  const results = { steps: [] };

  // ── Step 1: register_mcp_server ────────────────────────────────────────
  const mcpKeypair = Keypair.generate();
  const mcpPubkey = mcpKeypair.publicKey;
  const complianceHash = sha256(
    'DPO2U MCP server v0.3.0 — 70 tools, 17 jurisdictions, audit 2026-05-15',
  );
  const jurisdictionsSupported = [
    jurisdictionBytes('LGPD'),
    jurisdictionBytes('GDPR'),
    jurisdictionBytes('MGF-AGENTIC'),
  ];

  const [mcpServerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mcp_server'), authority.publicKey.toBuffer(), mcpPubkey.toBuffer()],
    AGENT_REGISTRY_PROGRAM_ID,
  );

  const registerData = coder.instruction.encode('register_mcp_server', {
    mcp_pubkey: mcpPubkey,
    name: 'dpo2u-compliance-mcp',
    compliance_hash: Array.from(complianceHash),
    jurisdictions_supported: jurisdictionsSupported.map((j) => Array.from(j)),
    audit_date: new BN(Math.floor(Date.now() / 1000)),
    audit_uri: 'ipfs://bafy.../dpo2u-mcp-audit-2026-05-15.json',
  });

  const sig1 = await sendIx(
    new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: mcpServerPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: registerData,
    }),
  );
  console.log(`✅ register_mcp_server → ${explorerUrl(sig1)}`);
  console.log(`   MCP server PDA: ${mcpServerPda.toBase58()}`);
  results.steps.push({ step: 'register_mcp_server', sig: sig1, pda: mcpServerPda.toBase58() });

  // ── Step 2: register_value_chain_node (root = Model Developer) ──────────
  const agentId = Buffer.from(sha256('claude-opus-4-7-deployment-acme-corp-2026-05'));
  const [rootNodePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('value_chain'),
      authority.publicKey.toBuffer(),
      agentId,
      Buffer.from([1]),
    ],
    AGENT_REGISTRY_PROGRAM_ID,
  );

  const rootData = coder.instruction.encode('register_value_chain_node', {
    agent_id: Array.from(agentId),
    role: 1, // ModelDeveloper
    parent: null,
    jurisdiction: Array.from(jurisdictionBytes('MGF-AGENTIC')),
    contract_uri: 'ipfs://bafy.../anthropic-model-dev-contract.json',
  });

  const sig2 = await sendIx(
    new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: rootNodePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: rootData,
    }),
  );
  console.log(`✅ register_value_chain_node (role=1 ModelDev) → ${explorerUrl(sig2)}`);
  console.log(`   Root node PDA: ${rootNodePda.toBase58()}`);
  results.steps.push({ step: 'value_chain_root', sig: sig2, pda: rootNodePda.toBase58() });

  // ── Step 3: register_value_chain_node (role=4 DeployingOrg, parent=root)
  const [deployingNodePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('value_chain'),
      authority.publicKey.toBuffer(),
      agentId,
      Buffer.from([4]),
    ],
    AGENT_REGISTRY_PROGRAM_ID,
  );

  const deployingData = coder.instruction.encode('register_value_chain_node', {
    agent_id: Array.from(agentId),
    role: 4, // DeployingOrg
    parent: rootNodePda,
    jurisdiction: Array.from(jurisdictionBytes('MGF-AGENTIC')),
    contract_uri: 'ipfs://bafy.../acme-corp-deployment-contract.json',
  });

  const sig3 = await sendIx(
    new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: deployingNodePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: deployingData,
    }),
  );
  console.log(`✅ register_value_chain_node (role=4 DeployingOrg, parent=root) → ${explorerUrl(sig3)}`);
  console.log(`   DeployingOrg node PDA: ${deployingNodePda.toBase58()}`);
  results.steps.push({ step: 'value_chain_deploying', sig: sig3, pda: deployingNodePda.toBase58() });

  // ── Step 4: revoke_mcp_server ──────────────────────────────────────────
  const revokeData = coder.instruction.encode('revoke_mcp_server', { reason_code: 1 });
  const sig4 = await sendIx(
    new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        { pubkey: mcpServerPda, isSigner: false, isWritable: true },
      ],
      data: revokeData,
    }),
  );
  console.log(`✅ revoke_mcp_server (reason=1) → ${explorerUrl(sig4)}`);
  results.steps.push({ step: 'revoke_mcp_server', sig: sig4 });

  // ── Decode the McpServer account to verify state ────────────────────────
  const info = await connection.getAccountInfo(mcpServerPda, 'confirmed');
  if (info) {
    const decoded = coder.accounts.decode('McpServer', info.data);
    console.log(`\n📋 McpServer account state:`);
    console.log(`   name: ${decoded.name}`);
    console.log(`   jurisdictions: ${decoded.jurisdictions_supported.length}`);
    console.log(`   revoked_at: ${decoded.revoked_at}`);
    results.mcp_server_state = {
      name: decoded.name,
      jurisdictions_count: decoded.jurisdictions_supported.length,
      revoked_at: decoded.revoked_at ? Number(decoded.revoked_at) : null,
    };
  }

  fs.writeFileSync(
    './smoke-agent-registry-r2-result.json',
    JSON.stringify(results, null, 2),
  );
  console.log(`\n✅ All 4 steps green. Results written to smoke-agent-registry-r2-result.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
