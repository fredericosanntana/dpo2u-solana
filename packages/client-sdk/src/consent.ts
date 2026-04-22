/**
 * DPO2UConsentClient — build and submit consent-manager transactions
 * (DPDP India §6 / Rules 2025 Capítulo 2).
 *
 * Mirrors the shape of DPO2UClient (compliance-registry) but targets the
 * `consent_manager` program. Uses the same IDL-load-at-runtime pattern.
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

import { VERIFIER_PROGRAM_ID } from './client.js';

export const CONSENT_MANAGER_PROGRAM_ID = new PublicKey(
  'D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB',
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

export interface DPO2UConsentClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  /** Data fiduciary's keypair — signs record_consent; also pays rent for the PDA. */
  signer: Keypair;
  /** Absolute path to consent_manager IDL json. Defaults to the repo's build artifact. */
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface RecordConsentArgs {
  /** User's Solana pubkey (citizen wallet / DID controller). */
  user: PublicKey;
  /** Numeric purpose code — taxonomy defined off-chain by the data fiduciary (u16). */
  purposeCode: number;
  /** Hash-able purpose text. If provided, purposeHash is auto-computed as sha256(purposeText). */
  purposeText?: string;
  /** Raw purpose hash (32 bytes). Required if purposeText is not provided. */
  purposeHash?: Uint8Array;
  /** Off-chain evidence URI (IPFS/Shadow Drive). Max 128 bytes. */
  storageUri?: string;
  /** Unix timestamp at which consent expires (null = no expiry). */
  expiresAt?: bigint | null;
}

export interface RecordVerifiedConsentArgs extends RecordConsentArgs {
  /** 356-byte SP1 v6 Groth16 proof bytes. */
  proof: Uint8Array;
  /** 96-byte ABI-encoded PublicValuesStruct from the proof. */
  publicInputs: Uint8Array;
}

export interface ConsentRecord {
  user: PublicKey;
  dataFiduciary: PublicKey;
  purposeCode: number;
  purposeHash: Uint8Array;
  storageUri: string;
  issuedAt: bigint;
  expiresAt: bigint | null;
  revokedAt: bigint | null;
  revocationReason: string | null;
  version: number;
  verified: boolean;
  threshold: number;
}

export class DPO2UConsentClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly computeUnitLimit: number;
  private readonly cluster: ClusterName;

  constructor(opts: DPO2UConsentClientOptions) {
    this.cluster = opts.cluster ?? 'localnet';
    this.connection = new Connection(opts.rpcUrl ?? CLUSTER_URLS[this.cluster], 'confirmed');
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 400_000;

    const idlPath = opts.idlPath ?? DPO2UConsentClient.defaultIdlPath();
    const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));
    this.coder = new BorshCoder(idl);
  }

  static defaultIdlPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, './idl/consent_manager.json'),
      path.resolve(here, '../idl/consent_manager.json'),
      path.resolve(here, '../../../solana-programs/target/idl/consent_manager.json'),
    ];
    for (const p of candidates) {
      try {
        if (readFileSync(p, 'utf-8').length > 0) return p;
      } catch {
        /* try next */
      }
    }
    return candidates[candidates.length - 1];
  }

  /**
   * Derives the consent PDA — seeds `[b"consent", user, data_fiduciary, purpose_hash]`.
   * Matches the Rust program's `#[account(seeds = ...)]` exactly.
   */
  deriveConsentPda(
    user: PublicKey,
    dataFiduciary: PublicKey,
    purposeHash: Uint8Array,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('consent'),
        user.toBuffer(),
        dataFiduciary.toBuffer(),
        Buffer.from(purposeHash),
      ],
      CONSENT_MANAGER_PROGRAM_ID,
    );
  }

  /** Helper: sha256 a purpose text to produce a purpose_hash. */
  static purposeHashFromText(text: string): Uint8Array {
    return createHash('sha256').update(text).digest();
  }

  private resolvePurposeHash(args: { purposeText?: string; purposeHash?: Uint8Array }): Uint8Array {
    if (args.purposeHash) {
      if (args.purposeHash.length !== 32) {
        throw new Error(`purposeHash must be 32 bytes, got ${args.purposeHash.length}`);
      }
      return args.purposeHash;
    }
    if (args.purposeText) {
      return DPO2UConsentClient.purposeHashFromText(args.purposeText);
    }
    throw new Error('Either purposeText or purposeHash must be provided');
  }

  /**
   * Submit `record_consent` (trusted-fiduciary path).
   */
  async recordConsent(args: RecordConsentArgs): Promise<{
    signature: string;
    consentPda: PublicKey;
    explorerUrl: string;
  }> {
    const purposeHash = this.resolvePurposeHash(args);
    const fiduciary = this.signer.publicKey;
    const [consentPda] = this.deriveConsentPda(args.user, fiduciary, purposeHash);

    const data = this.coder.instruction.encode('record_consent', {
      purpose_code: args.purposeCode,
      purpose_hash: Array.from(purposeHash),
      storage_uri: args.storageUri ?? '',
      expires_at: args.expiresAt ?? null,
    });

    const ix = new TransactionInstruction({
      programId: CONSENT_MANAGER_PROGRAM_ID,
      keys: [
        { pubkey: fiduciary, isSigner: true, isWritable: true },
        { pubkey: args.user, isSigner: false, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = fiduciary;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer], {
      commitment: 'confirmed',
    });

    return {
      signature,
      consentPda,
      explorerUrl: `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER[this.cluster]}`,
    };
  }

  /**
   * Submit `record_verified_consent` (ZK-bound path).
   */
  async recordVerifiedConsent(args: RecordVerifiedConsentArgs): Promise<{
    signature: string;
    consentPda: PublicKey;
    explorerUrl: string;
  }> {
    if (args.proof.length !== 356) {
      throw new Error(`proof must be 356 bytes, got ${args.proof.length}`);
    }
    if (args.publicInputs.length !== 96) {
      throw new Error(`publicInputs must be 96 bytes, got ${args.publicInputs.length}`);
    }

    // purpose_hash MUST match subject_commitment inside the proof — we surface
    // this as a local pre-check so the caller gets a clearer error than the
    // on-chain PurposeMismatch.
    const decodedCommitment = args.publicInputs.slice(32, 64);
    const purposeHash = this.resolvePurposeHash(args);
    if (!Buffer.from(purposeHash).equals(Buffer.from(decodedCommitment))) {
      throw new Error(
        'purposeHash does not match subject_commitment inside proof (bytes [32..64] of publicInputs)',
      );
    }

    const fiduciary = this.signer.publicKey;
    const [consentPda] = this.deriveConsentPda(args.user, fiduciary, purposeHash);

    const data = this.coder.instruction.encode('record_verified_consent', {
      purpose_code: args.purposeCode,
      purpose_hash: Array.from(purposeHash),
      proof: Buffer.from(args.proof),
      public_inputs: Buffer.from(args.publicInputs),
      storage_uri: args.storageUri ?? '',
      expires_at: args.expiresAt ?? null,
    });

    const ix = new TransactionInstruction({
      programId: CONSENT_MANAGER_PROGRAM_ID,
      keys: [
        { pubkey: fiduciary, isSigner: true, isWritable: true },
        { pubkey: args.user, isSigner: false, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
        { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: this.computeUnitLimit,
    });

    const tx = new Transaction().add(computeIx).add(ix);
    tx.feePayer = fiduciary;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer], {
      commitment: 'confirmed',
    });

    return {
      signature,
      consentPda,
      explorerUrl: `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER[this.cluster]}`,
    };
  }

  /**
   * Submits `revoke_consent`. Only the original user (not fiduciary) may call —
   * the on-chain program enforces via `require_keys_eq!(rec.user, user.key())`.
   *
   * Note: the `signer` passed to this client instance MUST be the user's
   * keypair when calling revoke. (Pass a separate client instance if you need
   * to revoke as a different signer.)
   */
  async revokeConsent(args: {
    consent: PublicKey;
    reason: string;
  }): Promise<{ signature: string; explorerUrl: string }> {
    if (args.reason.length > 64) {
      throw new Error(`reason must be <= 64 bytes, got ${args.reason.length}`);
    }

    const data = this.coder.instruction.encode('revoke_consent', {
      reason: args.reason,
    });

    const ix = new TransactionInstruction({
      programId: CONSENT_MANAGER_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: args.consent, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = this.signer.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer], {
      commitment: 'confirmed',
    });

    return {
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER[this.cluster]}`,
    };
  }

  /**
   * Fetch a consent record from the chain and decode it.
   */
  async fetchConsent(
    user: PublicKey,
    dataFiduciary: PublicKey,
    purposeHash: Uint8Array,
  ): Promise<ConsentRecord | null> {
    const [pda] = this.deriveConsentPda(user, dataFiduciary, purposeHash);
    const info = await this.connection.getAccountInfo(pda, 'confirmed');
    if (!info) return null;
    const decoded = this.coder.accounts.decode<any>(
      'ConsentRecord',
      Buffer.from(info.data),
    );
    return {
      user: decoded.user,
      dataFiduciary: decoded.dataFiduciary,
      purposeCode: decoded.purposeCode,
      purposeHash: new Uint8Array(decoded.purposeHash),
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

  getConnection(): Connection {
    return this.connection;
  }
}
