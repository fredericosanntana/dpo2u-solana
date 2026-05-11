/**
 * DPO2UPipaClient — PIPA Korea Art. 24 ZK Identity Registry.
 *
 * Note: `issueAttestation` requires a real SP1 v6 Groth16 proof bound to the
 * `subject_commitment`. Use the same proof generation pipeline as
 * compliance-registry / consent-manager — this SDK does NOT generate proofs.
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
import { VERIFIER_PROGRAM_ID } from './client.js';

export const PIPA_KOREA_ZK_ID_PROGRAM_ID = new PublicKey(
  '41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR',
);

export const ATTRIBUTE_KIND = {
  AGE_GATE_19: 1,
  KOREAN_RESIDENT: 2,
  KYC_VERIFIED: 3,
  DOMESTIC_REPRESENTATIVE: 4,
} as const;

export type AttributeKind = (typeof ATTRIBUTE_KIND)[keyof typeof ATTRIBUTE_KIND];

export interface DPO2UPipaClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface IssueAttestationArgs {
  /** Opaque commitment (Poseidon/SHA-256 of identity_secret + salt). 32 bytes. */
  subjectCommitment: Uint8Array;
  attributeKind: AttributeKind;
  attributeMetadataHash: Uint8Array;
  /** SP1 v6 Groth16 proof bytes (356 bytes). */
  proof: Uint8Array;
  /** ABI-encoded PublicValuesStruct (96 bytes). public_inputs[32..64] must equal subjectCommitment. */
  publicInputs: Uint8Array;
  expiresAt?: bigint | null;
  storageUri?: string;
}

export class DPO2UPipaClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2UPipaClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 1_400_000; // SP1 verifier CPI is heavy
    this.coder = new BorshCoder(loadIdl('pipa_korea_zk_identity.json', opts.idlPath));
  }

  derivePda(
    attestor: PublicKey,
    subjectCommitment: Uint8Array,
    attributeKind: AttributeKind,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('pipa_zk_id'),
        attestor.toBuffer(),
        Buffer.from(subjectCommitment),
        Buffer.from([attributeKind]),
      ],
      PIPA_KOREA_ZK_ID_PROGRAM_ID,
    );
  }

  async issueAttestation(args: IssueAttestationArgs): Promise<{
    signature: string;
    attestationPda: PublicKey;
    explorerUrl: string;
  }> {
    if (args.subjectCommitment.length !== 32) {
      throw new Error('subjectCommitment must be 32 bytes');
    }
    if (args.attributeMetadataHash.length !== 32) {
      throw new Error('attributeMetadataHash must be 32 bytes');
    }
    if (args.proof.length !== 356) throw new Error('proof must be 356 bytes (SP1 v6 Groth16)');
    if (args.publicInputs.length !== 96) throw new Error('publicInputs must be 96 bytes');

    const decodedCommitment = args.publicInputs.slice(32, 64);
    if (!Buffer.from(args.subjectCommitment).equals(Buffer.from(decodedCommitment))) {
      throw new Error(
        'subjectCommitment does not match publicInputs[32..64] — proof binding will fail on-chain',
      );
    }

    const attestor = this.signer.publicKey;
    const [attestationPda] = this.derivePda(attestor, args.subjectCommitment, args.attributeKind);

    const data = this.coder.instruction.encode('issue_attestation', {
      subject_commitment: Array.from(args.subjectCommitment),
      attribute_kind: args.attributeKind,
      attribute_metadata_hash: Array.from(args.attributeMetadataHash),
      proof: Buffer.from(args.proof),
      public_inputs: Buffer.from(args.publicInputs),
      expires_at: args.expiresAt ?? null,
      storage_uri: args.storageUri ?? '',
    });
    const ix = new TransactionInstruction({
      programId: PIPA_KOREA_ZK_ID_PROGRAM_ID,
      keys: [
        { pubkey: attestor, isSigner: true, isWritable: true },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
        { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = attestor;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, attestationPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async revokeAttestation(
    subjectCommitment: Uint8Array,
    attributeKind: AttributeKind,
    reason: string,
  ): Promise<{ signature: string; explorerUrl: string }> {
    if (reason.length > 64) throw new Error('reason exceeds 64 bytes');
    const attestor = this.signer.publicKey;
    const [attestationPda] = this.derivePda(attestor, subjectCommitment, attributeKind);
    const data = this.coder.instruction.encode('revoke_attestation', { reason });
    const ix = new TransactionInstruction({
      programId: PIPA_KOREA_ZK_ID_PROGRAM_ID,
      keys: [
        { pubkey: attestor, isSigner: true, isWritable: false },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = attestor;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async fetchAttestation(attestationPda: PublicKey): Promise<any | null> {
    const info = await this.connection.getAccountInfo(attestationPda, 'confirmed');
    if (!info) return null;
    return this.coder.accounts.decode('ZkIdentityAttestation', info.data);
  }
}
