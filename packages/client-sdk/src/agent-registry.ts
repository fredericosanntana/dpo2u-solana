/**
 * DPO2UAgentRegistryClient — covers the 3 new instructions added 2026-05-15
 * (Sprint Continuable round 2):
 *   - register_mcp_server / revoke_mcp_server  (IMDA MGF-Agentic MCP whitelist)
 *   - register_value_chain_node               (5-actor MGF + Kenney taxonomy)
 *
 * Note: on-chain upgrade of program 5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7
 * to expose these is pending devnet SOL airdrop window — IDL + bindings shipped
 * ahead of redeploy so callers can integrate.
 */

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
import { BorshCoder } from '@coral-xyz/anchor';
import {
  ClusterName,
  buildExplorerUrl,
  loadIdl,
  makeConnection,
} from './sprint-d-shared.js';

export const AGENT_REGISTRY_PROGRAM_ID = new PublicKey(
  '5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7',
);

export const VALUE_CHAIN_ROLE = {
  MODEL_DEVELOPER: 1,
  TOOL_PROVIDER: 2,
  AGENTIC_PROVIDER: 3,
  DEPLOYING_ORG: 4,
  END_USER: 5,
} as const;
export type ValueChainRole = (typeof VALUE_CHAIN_ROLE)[keyof typeof VALUE_CHAIN_ROLE];

export interface DPO2UAgentRegistryClientOptions {
  signer: Keypair;
  connection?: Connection;
  cluster?: ClusterName;
  computeUnitLimit?: number;
}

export class DPO2UAgentRegistryClient {
  readonly connection: Connection;
  readonly signer: Keypair;
  readonly cluster: ClusterName;
  readonly coder: BorshCoder;
  readonly computeUnitLimit: number;

  constructor(opts: DPO2UAgentRegistryClientOptions) {
    this.signer = opts.signer;
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = opts.connection ?? makeConnection(this.cluster);
    this.coder = new BorshCoder(loadIdl('agent_registry'));
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
  }

  static deriveMcpServerPda(authority: PublicKey, mcpPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('mcp_server'), authority.toBuffer(), mcpPubkey.toBuffer()],
      AGENT_REGISTRY_PROGRAM_ID,
    );
  }

  static deriveValueChainNodePda(
    authority: PublicKey,
    agentId: Uint8Array,
    role: ValueChainRole,
  ): [PublicKey, number] {
    if (agentId.length !== 32) throw new Error('agentId must be 32 bytes');
    return PublicKey.findProgramAddressSync(
      [Buffer.from('value_chain'), authority.toBuffer(), Buffer.from(agentId), Buffer.from([role])],
      AGENT_REGISTRY_PROGRAM_ID,
    );
  }

  async registerMcpServer(args: {
    mcpPubkey: PublicKey;
    name: string;
    complianceHash: Uint8Array;
    jurisdictionsSupported: Uint8Array[]; // each 16 bytes
    auditDate: number | bigint;
    auditUri: string;
  }): Promise<{ signature: string; mcpServerPda: PublicKey; explorerUrl: string }> {
    if (args.complianceHash.length !== 32) throw new Error('complianceHash must be 32 bytes');
    if (args.name.length === 0 || args.name.length > 48) throw new Error('name must be 1..=48 bytes');
    if (args.auditUri.length > 128) throw new Error('auditUri must be ≤ 128 bytes');
    if (args.jurisdictionsSupported.length > 8)
      throw new Error('jurisdictionsSupported max 8 entries');
    for (const j of args.jurisdictionsSupported) {
      if (j.length !== 16) throw new Error('each jurisdiction must be 16 bytes');
    }
    const [mcpServerPda] = DPO2UAgentRegistryClient.deriveMcpServerPda(
      this.signer.publicKey,
      args.mcpPubkey,
    );
    const data = this.coder.instruction.encode('register_mcp_server', {
      mcp_pubkey: args.mcpPubkey,
      name: args.name,
      compliance_hash: Array.from(args.complianceHash),
      jurisdictions_supported: args.jurisdictionsSupported.map((j) => Array.from(j)),
      audit_date: args.auditDate,
      audit_uri: args.auditUri,
    });
    const ix = new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mcpServerPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    return this.send(ix, { mcpServerPda });
  }

  async revokeMcpServer(args: {
    mcpPubkey: PublicKey;
    reasonCode: number;
  }): Promise<{ signature: string; explorerUrl: string }> {
    const [mcpServerPda] = DPO2UAgentRegistryClient.deriveMcpServerPda(
      this.signer.publicKey,
      args.mcpPubkey,
    );
    const data = this.coder.instruction.encode('revoke_mcp_server', {
      reason_code: args.reasonCode,
    });
    const ix = new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: mcpServerPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    return this.send(ix);
  }

  async registerValueChainNode(args: {
    agentId: Uint8Array; // 32 bytes
    role: ValueChainRole;
    parent: PublicKey | null;
    jurisdiction: Uint8Array; // 16 bytes
    contractUri: string;
  }): Promise<{ signature: string; nodePda: PublicKey; explorerUrl: string }> {
    if (args.agentId.length !== 32) throw new Error('agentId must be 32 bytes');
    if (args.jurisdiction.length !== 16) throw new Error('jurisdiction must be 16 bytes');
    if (args.contractUri.length > 128) throw new Error('contractUri must be ≤ 128 bytes');
    if (args.role < 1 || args.role > 5) throw new Error('role must be 1..=5');
    const [nodePda] = DPO2UAgentRegistryClient.deriveValueChainNodePda(
      this.signer.publicKey,
      args.agentId,
      args.role,
    );
    const data = this.coder.instruction.encode('register_value_chain_node', {
      agent_id: Array.from(args.agentId),
      role: args.role,
      parent: args.parent,
      jurisdiction: Array.from(args.jurisdiction),
      contract_uri: args.contractUri,
    });
    const ix = new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: nodePda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    return this.send(ix, { nodePda });
  }

  private async send<T extends Record<string, unknown> = Record<string, never>>(
    ix: TransactionInstruction,
    extra?: T,
  ): Promise<{ signature: string; explorerUrl: string } & T> {
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return {
      signature,
      explorerUrl: buildExplorerUrl(signature, this.cluster),
      ...(extra as T),
    };
  }
}
