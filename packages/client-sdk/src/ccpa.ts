/**
 * DPO2UCcpaClient — CCPA §1798.135 Opt-Out Registry (California).
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
import { createHash } from 'node:crypto';
import {
  ClusterName,
  buildExplorerUrl,
  loadIdl,
  makeConnection,
} from './sprint-d-shared.js';

export const CCPA_OPTOUT_PROGRAM_ID = new PublicKey(
  '5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk',
);

export const OPTOUT_KIND = {
  SALE: 1,
  SHARE: 2,
  SENSITIVE: 3,
} as const;

export type OptoutKind = (typeof OPTOUT_KIND)[keyof typeof OPTOUT_KIND];

export interface DPO2UCcpaClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface RegisterOptoutArgs {
  /** Opaque consumer identifier (NOT wallet pubkey). Hashed via sha256. */
  consumerId?: string;
  consumerCommitmentHash?: Uint8Array;
  optoutKind: OptoutKind;
  /** Whether opt-out came via Global Privacy Control signal. */
  viaGpc: boolean;
  storageUri?: string;
}

export class DPO2UCcpaClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2UCcpaClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
    this.coder = new BorshCoder(loadIdl('ccpa_optout_registry.json', opts.idlPath));
  }

  static consumerCommitmentHash(consumerId: string): Uint8Array {
    return createHash('sha256').update(consumerId).digest();
  }

  derivePda(
    business: PublicKey,
    consumerCommitmentHash: Uint8Array,
    optoutKind: OptoutKind,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('ccpa_optout'),
        business.toBuffer(),
        Buffer.from(consumerCommitmentHash),
        Buffer.from([optoutKind]),
      ],
      CCPA_OPTOUT_PROGRAM_ID,
    );
  }

  private resolveCommitmentHash(args: RegisterOptoutArgs): Uint8Array {
    if (args.consumerCommitmentHash) {
      if (args.consumerCommitmentHash.length !== 32) {
        throw new Error(`consumerCommitmentHash must be 32 bytes`);
      }
      return args.consumerCommitmentHash;
    }
    if (args.consumerId) return DPO2UCcpaClient.consumerCommitmentHash(args.consumerId);
    throw new Error('Either consumerId or consumerCommitmentHash must be provided');
  }

  async registerOptout(args: RegisterOptoutArgs): Promise<{
    signature: string;
    optoutPda: PublicKey;
    explorerUrl: string;
  }> {
    const commitmentHash = this.resolveCommitmentHash(args);
    const business = this.signer.publicKey;
    const [optoutPda] = this.derivePda(business, commitmentHash, args.optoutKind);

    const data = this.coder.instruction.encode('register_optout', {
      consumer_commitment_hash: Array.from(commitmentHash),
      optout_kind: args.optoutKind,
      via_gpc: args.viaGpc,
      storage_uri: args.storageUri ?? '',
    });
    const ix = new TransactionInstruction({
      programId: CCPA_OPTOUT_PROGRAM_ID,
      keys: [
        { pubkey: business, isSigner: true, isWritable: true },
        { pubkey: optoutPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = business;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return {
      signature,
      optoutPda,
      explorerUrl: buildExplorerUrl(signature, this.cluster),
    };
  }

  /**
   * Reverse opt-out — only consumer can sign. Off-chain, business MUST verify
   * the signer's binding to consumer_commitment_hash before submitting.
   */
  async reverseOptout(
    business: PublicKey,
    consumerCommitmentHash: Uint8Array,
    optoutKind: OptoutKind,
    consumerSigner: Keypair,
  ): Promise<{ signature: string; explorerUrl: string }> {
    const [optoutPda] = this.derivePda(business, consumerCommitmentHash, optoutKind);
    const data = this.coder.instruction.encode('reverse_optout', {});
    const ix = new TransactionInstruction({
      programId: CCPA_OPTOUT_PROGRAM_ID,
      keys: [
        { pubkey: consumerSigner.publicKey, isSigner: true, isWritable: false },
        { pubkey: optoutPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = consumerSigner.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [consumerSigner]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async fetchOptout(optoutPda: PublicKey): Promise<any | null> {
    const info = await this.connection.getAccountInfo(optoutPda, 'confirmed');
    if (!info) return null;
    return this.coder.accounts.decode('OptoutRecord', info.data);
  }
}
