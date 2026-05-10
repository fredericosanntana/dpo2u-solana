/**
 * DPO2UPipedaClient — PIPEDA Schedule 1 Consent Extension (Canada federal).
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

export const PIPEDA_CONSENT_EXT_PROGRAM_ID = new PublicKey(
  'G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT',
);

export const CONSENT_FORM = {
  EXPRESS: 1,
  IMPLIED: 2,
  OPT_OUT: 3,
} as const;

export type ConsentForm = (typeof CONSENT_FORM)[keyof typeof CONSENT_FORM];

export interface DPO2UPipedaClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface RecordPipedaConsentArgs {
  subject: PublicKey;
  purposeCode: number;
  purposeText?: string;
  purposeHash?: Uint8Array;
  consentForm: ConsentForm;
  /** Bitmap principles 1-10 (bit N = principle N). Common: 0xFE (P2-P8). */
  principlesEvidenced: number;
  /** ISO-3166-1 alpha-2 country code, e.g. "US", "BR". */
  crossBorderDestination?: string | null;
  storageUri?: string;
}

export class DPO2UPipedaClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2UPipedaClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
    this.coder = new BorshCoder(loadIdl('pipeda_consent_extension.json', opts.idlPath));
  }

  static purposeHashFromText(text: string): Uint8Array {
    return createHash('sha256').update(text).digest();
  }

  derivePda(
    subject: PublicKey,
    organization: PublicKey,
    purposeHash: Uint8Array,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('pipeda_consent'),
        subject.toBuffer(),
        organization.toBuffer(),
        Buffer.from(purposeHash),
      ],
      PIPEDA_CONSENT_EXT_PROGRAM_ID,
    );
  }

  private resolvePurposeHash(args: { purposeText?: string; purposeHash?: Uint8Array }): Uint8Array {
    if (args.purposeHash) {
      if (args.purposeHash.length !== 32) throw new Error('purposeHash must be 32 bytes');
      return args.purposeHash;
    }
    if (args.purposeText) return DPO2UPipedaClient.purposeHashFromText(args.purposeText);
    throw new Error('Either purposeText or purposeHash required');
  }

  private encodeCountry(country?: string | null): number[] | null {
    if (!country) return null;
    if (country.length !== 2) throw new Error('crossBorderDestination must be ISO-3166-1 alpha-2');
    return [country.charCodeAt(0), country.charCodeAt(1)];
  }

  async recordPipedaConsent(args: RecordPipedaConsentArgs): Promise<{
    signature: string;
    consentPda: PublicKey;
    explorerUrl: string;
  }> {
    const purposeHash = this.resolvePurposeHash(args);
    const organization = this.signer.publicKey;
    const [consentPda] = this.derivePda(args.subject, organization, purposeHash);

    const data = this.coder.instruction.encode('record_pipeda_consent', {
      purpose_code: args.purposeCode,
      purpose_hash: Array.from(purposeHash),
      consent_form: args.consentForm,
      principles_evidenced: args.principlesEvidenced,
      cross_border_destination: this.encodeCountry(args.crossBorderDestination),
      storage_uri: args.storageUri ?? '',
    });
    const ix = new TransactionInstruction({
      programId: PIPEDA_CONSENT_EXT_PROGRAM_ID,
      keys: [
        { pubkey: organization, isSigner: true, isWritable: true },
        { pubkey: args.subject, isSigner: false, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = organization;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, consentPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  /** Withdraw consent — only subject (Principle 4.3.8). */
  async withdrawConsent(
    consentPda: PublicKey,
    reason: string,
    subjectSigner: Keypair,
  ): Promise<{ signature: string; explorerUrl: string }> {
    if (reason.length > 64) throw new Error('reason exceeds 64 bytes');
    const data = this.coder.instruction.encode('withdraw_consent', { reason });
    const ix = new TransactionInstruction({
      programId: PIPEDA_CONSENT_EXT_PROGRAM_ID,
      keys: [
        { pubkey: subjectSigner.publicKey, isSigner: true, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = subjectSigner.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [subjectSigner]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async flagRrosh(consentPda: PublicKey): Promise<{ signature: string; explorerUrl: string }> {
    const organization = this.signer.publicKey;
    const data = this.coder.instruction.encode('flag_rrosh', {});
    const ix = new TransactionInstruction({
      programId: PIPEDA_CONSENT_EXT_PROGRAM_ID,
      keys: [
        { pubkey: organization, isSigner: true, isWritable: false },
        { pubkey: consentPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = organization;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async fetchConsent(consentPda: PublicKey): Promise<any | null> {
    const info = await this.connection.getAccountInfo(consentPda, 'confirmed');
    if (!info) return null;
    return this.coder.accounts.decode('PipedaConsentRecord', info.data);
  }
}
