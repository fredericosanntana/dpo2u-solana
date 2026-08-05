/**
 * DPO2ULegalManifestClient — on-chain pointer to off-chain legal corpus.
 *
 * Backed by the `legal_source_manifest` Solana program (ID
 * `eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK`). Each jurisdiction the
 * dpo2u-legal-worker syncs gets a singleton PDA storing:
 *   - content_hash (sha256 of the worker's aggregate hash)
 *   - manifest_version (monotonic counter)
 *   - effective_date (unix ts of the underlying legal corpus version)
 *   - source_uri (URL/IPFS pointer)
 *   - authority (Pubkey allowed to update)
 *
 * Companion to:
 *   - `dpo2u-legal-worker` (off-chain JSONL producer)
 *   - `resolve_legal_citation` MCP tool (reads worker output, returns
 *     content_hash; callers verify it matches the on-chain PDA before trusting
 *     the citation).
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
// @coral-xyz/anchor is CJS — BN is not a named ESM export, so reach in via namespace.
import anchorPkg from '@coral-xyz/anchor';
const { BN } = anchorPkg;
import {
  ClusterName,
  buildExplorerUrl,
  loadIdl,
  makeConnection,
} from './sprint-d-shared.js';

export const LEGAL_SOURCE_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

export const JURISDICTION_SEED_LEN = 16;

export interface DPO2ULegalManifestClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export interface InitManifestArgs {
  jurisdiction: string;
  contentHash: Uint8Array;
  effectiveDate: number | bigint;
  sourceUri: string;
}

export interface UpdateManifestArgs {
  jurisdiction: string;
  contentHash: Uint8Array;
  effectiveDate: number | bigint;
  sourceUri: string;
}

export interface TransferAuthorityArgs {
  jurisdiction: string;
  newAuthority: PublicKey;
}

export interface LegalSourceManifestAccount {
  jurisdiction: string;
  contentHash: Uint8Array;
  manifestVersion: number;
  effectiveDate: bigint;
  lastSync: bigint;
  sourceUri: string;
  authority: PublicKey;
  bump: number;
}

export class DPO2ULegalManifestClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2ULegalManifestClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
    this.coder = new BorshCoder(loadIdl('legal_source_manifest.json', opts.idlPath));
  }

  /**
   * NUL-pad the ASCII jurisdiction code to a fixed 16-byte buffer. Throws if
   * the code overflows the seed width — keep codes ≤16 ASCII chars
   * (`Vietnam-Decree-13` is exactly 17 → must be aliased to `VN-D13` or
   * similar before passing).
   */
  static jurisdictionBytes(jurisdiction: string): Uint8Array {
    const buf = Buffer.alloc(JURISDICTION_SEED_LEN);
    const ascii = Buffer.from(jurisdiction, 'ascii');
    if (ascii.length > JURISDICTION_SEED_LEN) {
      throw new Error(
        `jurisdiction "${jurisdiction}" exceeds ${JURISDICTION_SEED_LEN}-byte seed width; alias it`,
      );
    }
    ascii.copy(buf);
    return new Uint8Array(buf);
  }

  /** Derive the singleton PDA for a jurisdiction. */
  static derivePda(jurisdiction: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('legal_manifest'), DPO2ULegalManifestClient.jurisdictionBytes(jurisdiction)],
      LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
    );
  }

  /** Convenience: SHA-256 of an arbitrary string (for content_hash). */
  static async hash(s: string): Promise<Uint8Array> {
    const { createHash } = await import('node:crypto');
    return new Uint8Array(createHash('sha256').update(s).digest());
  }

  private assertHash(h: Uint8Array, label: string): void {
    if (h.length !== 32) throw new Error(`${label} must be 32 bytes, got ${h.length}`);
  }

  async initManifest(args: InitManifestArgs): Promise<{
    signature: string;
    manifestPda: PublicKey;
    explorerUrl: string;
  }> {
    this.assertHash(args.contentHash, 'contentHash');
    const jurisdictionBytes = DPO2ULegalManifestClient.jurisdictionBytes(args.jurisdiction);
    const [manifestPda] = DPO2ULegalManifestClient.derivePda(args.jurisdiction);

    const data = this.coder.instruction.encode('init_manifest', {
      jurisdiction: Array.from(jurisdictionBytes),
      content_hash: Array.from(args.contentHash),
      effective_date: new BN(args.effectiveDate.toString()),
      source_uri: args.sourceUri,
    });

    const ix = new TransactionInstruction({
      programId: LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: manifestPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return {
      signature,
      manifestPda,
      explorerUrl: buildExplorerUrl(signature, this.cluster),
    };
  }

  async updateManifest(args: UpdateManifestArgs): Promise<{
    signature: string;
    manifestPda: PublicKey;
    explorerUrl: string;
  }> {
    this.assertHash(args.contentHash, 'contentHash');
    const [manifestPda] = DPO2ULegalManifestClient.derivePda(args.jurisdiction);

    const data = this.coder.instruction.encode('update_manifest', {
      content_hash: Array.from(args.contentHash),
      effective_date: new BN(args.effectiveDate.toString()),
      source_uri: args.sourceUri,
    });

    const ix = new TransactionInstruction({
      programId: LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: manifestPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, manifestPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async transferAuthority(args: TransferAuthorityArgs): Promise<{
    signature: string;
    manifestPda: PublicKey;
    explorerUrl: string;
  }> {
    const [manifestPda] = DPO2ULegalManifestClient.derivePda(args.jurisdiction);

    const data = this.coder.instruction.encode('transfer_authority', {
      new_authority: args.newAuthority,
    });

    const ix = new TransactionInstruction({
      programId: LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: manifestPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);

    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, manifestPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  /** Fetch + decode the on-chain manifest for a jurisdiction. */
  async fetch(jurisdiction: string): Promise<LegalSourceManifestAccount | null> {
    const [pda] = DPO2ULegalManifestClient.derivePda(jurisdiction);
    const acc = await this.connection.getAccountInfo(pda);
    if (!acc) return null;
    const decoded = this.coder.accounts.decode<{
      jurisdiction: number[];
      content_hash: number[];
      manifest_version: number;
      effective_date: bigint;
      last_sync: bigint;
      source_uri: string;
      authority: PublicKey;
      bump: number;
    }>('LegalSourceManifestAccount', acc.data);

    // Strip trailing NUL bytes from the fixed-width jurisdiction code
    const codeBytes = Buffer.from(decoded.jurisdiction);
    const nul = codeBytes.indexOf(0);
    const code = (nul < 0 ? codeBytes : codeBytes.subarray(0, nul)).toString('ascii');

    return {
      jurisdiction: code,
      contentHash: new Uint8Array(decoded.content_hash),
      manifestVersion: decoded.manifest_version,
      effectiveDate: BigInt(decoded.effective_date),
      lastSync: BigInt(decoded.last_sync),
      sourceUri: decoded.source_uri,
      authority: decoded.authority,
      bump: decoded.bump,
    };
  }
}
