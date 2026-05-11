/**
 * DPO2UPopiaClient — POPIA §55 Information Officer Registry (South Africa).
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

export const POPIA_INFO_OFFICER_PROGRAM_ID = new PublicKey(
  'ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb',
);

export interface DPO2UPopiaClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface RegisterAppointmentArgs {
  informationOfficer: PublicKey;
  /** Used as input to derive organization_id_hash via sha256 (or pass raw 32-byte hash). */
  organizationId?: string;
  organizationIdHash?: Uint8Array;
  /** Sha-256 of contact details (kept off-chain for POPIA Condition 4 minimality). */
  contactHash: Uint8Array;
  storageUri?: string;
}

export class DPO2UPopiaClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2UPopiaClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
    this.coder = new BorshCoder(loadIdl('popia_info_officer_registry.json', opts.idlPath));
  }

  static organizationIdHash(orgId: string): Uint8Array {
    return createHash('sha256').update(orgId).digest();
  }

  derivePda(responsibleParty: PublicKey, organizationIdHash: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('popia_io'), responsibleParty.toBuffer(), Buffer.from(organizationIdHash)],
      POPIA_INFO_OFFICER_PROGRAM_ID,
    );
  }

  private resolveOrganizationIdHash(args: RegisterAppointmentArgs): Uint8Array {
    if (args.organizationIdHash) {
      if (args.organizationIdHash.length !== 32) {
        throw new Error(`organizationIdHash must be 32 bytes, got ${args.organizationIdHash.length}`);
      }
      return args.organizationIdHash;
    }
    if (args.organizationId) return DPO2UPopiaClient.organizationIdHash(args.organizationId);
    throw new Error('Either organizationId or organizationIdHash must be provided');
  }

  async registerAppointment(args: RegisterAppointmentArgs): Promise<{
    signature: string;
    appointmentPda: PublicKey;
    explorerUrl: string;
  }> {
    if (args.contactHash.length !== 32) {
      throw new Error(`contactHash must be 32 bytes, got ${args.contactHash.length}`);
    }
    const orgIdHash = this.resolveOrganizationIdHash(args);
    const responsibleParty = this.signer.publicKey;
    const [appointmentPda] = this.derivePda(responsibleParty, orgIdHash);

    const data = this.coder.instruction.encode('register_appointment', {
      organization_id_hash: Array.from(orgIdHash),
      contact_hash: Array.from(args.contactHash),
      storage_uri: args.storageUri ?? '',
    });
    const ix = new TransactionInstruction({
      programId: POPIA_INFO_OFFICER_PROGRAM_ID,
      keys: [
        { pubkey: responsibleParty, isSigner: true, isWritable: true },
        { pubkey: args.informationOfficer, isSigner: false, isWritable: false },
        { pubkey: appointmentPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = responsibleParty;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer], {
      commitment: 'confirmed',
    });
    return {
      signature,
      appointmentPda,
      explorerUrl: buildExplorerUrl(signature, this.cluster),
    };
  }

  async setDeputy(
    organizationIdHash: Uint8Array,
    deputy: PublicKey | null,
  ): Promise<{ signature: string; explorerUrl: string }> {
    const responsibleParty = this.signer.publicKey;
    const [appointmentPda] = this.derivePda(responsibleParty, organizationIdHash);
    const data = this.coder.instruction.encode('set_deputy', { deputy });
    const ix = new TransactionInstruction({
      programId: POPIA_INFO_OFFICER_PROGRAM_ID,
      keys: [
        { pubkey: responsibleParty, isSigner: true, isWritable: false },
        { pubkey: appointmentPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = responsibleParty;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async revokeAppointment(
    organizationIdHash: Uint8Array,
    reason: string,
  ): Promise<{ signature: string; explorerUrl: string }> {
    if (reason.length > 64) throw new Error('reason exceeds 64 bytes');
    const responsibleParty = this.signer.publicKey;
    const [appointmentPda] = this.derivePda(responsibleParty, organizationIdHash);
    const data = this.coder.instruction.encode('revoke_appointment', { reason });
    const ix = new TransactionInstruction({
      programId: POPIA_INFO_OFFICER_PROGRAM_ID,
      keys: [
        { pubkey: responsibleParty, isSigner: true, isWritable: false },
        { pubkey: appointmentPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = responsibleParty;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async fetchAppointment(appointmentPda: PublicKey): Promise<any | null> {
    const info = await this.connection.getAccountInfo(appointmentPda, 'confirmed');
    if (!info) return null;
    return this.coder.accounts.decode('InfoOfficerAppointment', info.data);
  }
}
