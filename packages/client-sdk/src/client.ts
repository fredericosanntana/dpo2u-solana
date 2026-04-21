/**
 * DPO2UClient — build and submit `create_verified_attestation` transactions
 * against a Solana cluster (localnet / devnet / mainnet).
 *
 * Imports the compliance-registry IDL directly from the solana-programs build
 * tree at runtime via a relative path — keeps the SDK in sync with the
 * program signature automatically, no codegen step.
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
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROGRAM_IDS = {
  compliance_registry: new PublicKey('FrvXc4bqCG3268LVaLR3nwogWmDsVwnSqRE6M1dcdJc3'),
  agent_registry: new PublicKey('d8NoVV3Xz9PU9AoTA1SokMJjwY55kN7CEbVjhySGYym'),
  payment_gateway: new PublicKey('CbAYe2hsBZmrB4GB8VcLZDchUuDonoG15Cg6n9cnE7Cn'),
  fee_distributor: new PublicKey('9M88ZwVVrY5HF3T1XhuN1Hwen9YX7885c3TMed7u9zRd'),
  agent_wallet_factory: new PublicKey('BsJ6xWhvEhvJTsGNSiXHgJidysM92fLkAY38D48WAV1f'),
} as const;

export const VERIFIER_PROGRAM_ID = new PublicKey(
  '9mM8YFGjVQNqdVHfidfhFd76nBnC1Cbj5bxi17AwQFuB',
);

export type ClusterName = 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta';

const CLUSTER_URLS: Record<ClusterName, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

const EXPLORER_CLUSTER: Record<ClusterName, string> = {
  localnet: '?cluster=custom',
  devnet: '?cluster=devnet',
  testnet: '?cluster=testnet',
  'mainnet-beta': '',
};

export interface DPO2UClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  /** Keypair used as issuer + tx fee payer. */
  signer: Keypair;
  /** Absolute path to compliance_registry IDL json. Defaults to the repo's build artifact. */
  idlPath?: string;
  /** Override compute-unit limit. Default 400_000 — enough for pairing + CPI overhead. */
  computeUnitLimit?: number;
}

export interface AttestWithProofArgs {
  /** Subject's Solana pubkey (any — company wallet, DID controller, etc.). */
  subject: PublicKey;
  /** 356-byte SP1 v6 Groth16 proof bytes. */
  proof: Uint8Array;
  /** 96-byte ABI-encoded PublicValuesStruct from the proof. */
  publicInputs: Uint8Array;
  /** Optional — defaults to sha256 of the ASCII subject (matches the fixture). */
  commitment?: Uint8Array;
  /** Off-chain DPIA document URI. Max 128 bytes. */
  storageUri?: string;
  /** Schema identifier for the attestation payload. */
  schemaId?: PublicKey;
  /** Optional unix timestamp at which the attestation expires. */
  expiresAt?: bigint | null;
}

export interface AttestationRecord {
  subject: PublicKey;
  issuer: PublicKey;
  schemaId: PublicKey;
  commitment: Uint8Array;
  storageUri: string;
  issuedAt: bigint;
  expiresAt: bigint | null;
  revokedAt: bigint | null;
  revocationReason: string | null;
  version: number;
  verified: boolean;
  threshold: number;
}

export class DPO2UClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly computeUnitLimit: number;
  private readonly cluster: ClusterName;

  constructor(opts: DPO2UClientOptions) {
    this.cluster = opts.cluster ?? 'localnet';
    this.connection = new Connection(opts.rpcUrl ?? CLUSTER_URLS[this.cluster], 'confirmed');
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 400_000;

    const idlPath = opts.idlPath ?? DPO2UClient.defaultIdlPath();
    const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
    this.coder = new BorshCoder(idl);
  }

  static defaultIdlPath(): string {
    // When running from packages/client-sdk/dist/, the repo's IDL is at
    // ../../solana-programs/target/idl/compliance_registry.json.
    // At runtime, __dirname from ESM:
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/client.js → dist → client-sdk → packages → repo root
    return path.resolve(here, '../../../solana-programs/target/idl/compliance_registry.json');
  }

  /**
   * Derives the attestation PDA `[b"attestation", subject, commitment]`.
   */
  deriveAttestationPda(subject: PublicKey, commitment: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('attestation'), subject.toBuffer(), Buffer.from(commitment)],
      PROGRAM_IDS.compliance_registry,
    );
  }

  /**
   * Submit a `create_verified_attestation` transaction.
   * Returns the tx signature + the initialized attestation PDA.
   */
  async attestWithProof(args: AttestWithProofArgs): Promise<{
    signature: string;
    attestationPda: PublicKey;
    explorerUrl: string;
  }> {
    if (args.proof.length !== 356) {
      throw new Error(`proof must be 356 bytes, got ${args.proof.length}`);
    }
    if (args.publicInputs.length !== 96) {
      throw new Error(`publicInputs must be 96 bytes, got ${args.publicInputs.length}`);
    }

    // Default commitment = bytes[32..64] of publicInputs (the proof's subject_commitment).
    const commitment =
      args.commitment ?? Buffer.from(args.publicInputs.slice(32, 64));

    const data = this.coder.instruction.encode('create_verified_attestation', {
      commitment: Array.from(commitment),
      proof: Buffer.from(args.proof),
      public_inputs: Buffer.from(args.publicInputs),
      storage_uri: args.storageUri ?? 'ipfs://QmDPO2USprint4c',
      schema_id: args.schemaId ?? PublicKey.default,
      expires_at: args.expiresAt ?? null,
    });

    const [attestationPda] = this.deriveAttestationPda(args.subject, commitment);

    const verifyIx = new TransactionInstruction({
      programId: PROGRAM_IDS.compliance_registry,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: args.subject, isSigner: false, isWritable: false },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
        { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: this.computeUnitLimit,
    });

    const tx = new Transaction().add(computeIx).add(verifyIx);
    tx.feePayer = this.signer.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer], {
      commitment: 'confirmed',
    });

    return {
      signature,
      attestationPda,
      explorerUrl: `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER[this.cluster]}`,
    };
  }

  /**
   * Read an Attestation PDA and decode it.
   */
  async fetchAttestation(
    subject: PublicKey,
    commitment: Uint8Array,
  ): Promise<AttestationRecord | null> {
    const [pda] = this.deriveAttestationPda(subject, commitment);
    const info = await this.connection.getAccountInfo(pda, 'confirmed');
    if (!info) return null;
    const decoded = this.coder.accounts.decode<any>(
      'Attestation',
      Buffer.from(info.data),
    );
    return {
      subject: decoded.subject,
      issuer: decoded.issuer,
      schemaId: decoded.schemaId,
      commitment: new Uint8Array(decoded.commitment),
      storageUri: decoded.storageUri,
      issuedAt: BigInt(decoded.issuedAt.toString()),
      expiresAt: decoded.expiresAt !== null ? BigInt(decoded.expiresAt.toString()) : null,
      revokedAt: decoded.revokedAt !== null ? BigInt(decoded.revokedAt.toString()) : null,
      revocationReason: decoded.revocationReason ?? null,
      version: decoded.version,
      verified: decoded.verified,
      threshold: decoded.threshold,
    };
  }

  /** Helper: sha256 a subject string to produce a commitment. */
  static commitmentFromSubject(subject: string): Uint8Array {
    return createHash('sha256').update(subject).digest();
  }
}
