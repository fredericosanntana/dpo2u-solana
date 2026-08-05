/**
 * DPO2UHiroshimaClient — Hiroshima AI Process attestation (G7 ICOC + Japan
 * AIBOG/DS-920/AISI/AIST). Added 2026-05-15 (post-Sprint Replicate).
 *
 * Minimal client surface — focused on the verify_against_legal_manifest
 * cross-program reference. Full instruction coverage (attest_caio_appointment,
 * submit_red_team_evidence, commit_icoc_alignment, etc.) is accessible via
 * raw BorshCoder + TransactionInstruction; this client wraps verify because
 * that is the cross-framework attestation surface that consumers will use most.
 *
 * Hiroshima is cross-framework by design — its verify_against_legal_manifest
 * accepts ANY legal_source_manifest jurisdiction (JAPAN, EU-AIA, MGF-AGENTIC,
 * etc.) and the emitted AttestationVerifiedAgainstManifest event carries
 * whichever jurisdiction the manifest decodes.
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

export const HIROSHIMA_AI_PROCESS_PROGRAM_ID = new PublicKey(
  '4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx',
);

// Attestation type bytes (mirror Rust constants ATTEST_*)
export const HIROSHIMA_ATTESTATION_TYPE = {
  CAIO: 1,
  RED_TEAM: 2,
  ICOC: 3,
  DATA_QUALITY: 4,
  AIBOG: 5,
  RED_LINE_NEGATIVE: 6,
  HRIA: 7,
  INCIDENT: 8,
} as const;
export type HiroshimaAttestationType =
  (typeof HIROSHIMA_ATTESTATION_TYPE)[keyof typeof HIROSHIMA_ATTESTATION_TYPE];

export interface DPO2UHiroshimaClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  signer: Keypair;
  idlPath?: string;
  computeUnitLimit?: number;
}

export class DPO2UHiroshimaClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly coder: BorshCoder;
  private readonly cluster: ClusterName;
  private readonly computeUnitLimit: number;

  constructor(opts: DPO2UHiroshimaClientOptions) {
    this.cluster = opts.cluster ?? 'devnet';
    this.connection = makeConnection(this.cluster, opts.rpcUrl);
    this.signer = opts.signer;
    this.computeUnitLimit = opts.computeUnitLimit ?? 200_000;
    this.coder = new BorshCoder(loadIdl('hiroshima_ai_process_attestation.json', opts.idlPath));
  }

  /** Derive the attestation PDA for (attestor, ai_system_id, attestation_type). */
  static derivePda(
    attestor: PublicKey,
    aiSystemId: Uint8Array,
    attestationType: number,
  ): [PublicKey, number] {
    if (aiSystemId.length !== 32) {
      throw new Error(`ai_system_id must be 32 bytes, got ${aiSystemId.length}`);
    }
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('hiroshima_ai'),
        attestor.toBuffer(),
        Buffer.from(aiSystemId),
        Buffer.from([attestationType]),
      ],
      HIROSHIMA_AI_PROCESS_PROGRAM_ID,
    );
  }

  /**
   * Cross-program verify against ANY legal_source_manifest PDA. Hiroshima
   * accepts any jurisdiction (cross-framework attestation) — pass the
   * jurisdiction code for the manifest you want to anchor against.
   *
   * Emits AttestationVerifiedAgainstManifest with { attestor, ai_system_id,
   * attestation_type, jurisdiction[16], manifest_version, content_hash,
   * effective_date, verified_at }.
   */
  async verifyAgainstLegalManifest(args: {
    attestor: PublicKey;
    aiSystemId: Uint8Array;
    attestationType: number;
    legalManifestJurisdiction: string; // required — no default for cross-framework client
  }): Promise<{
    signature: string;
    attestationPda: PublicKey;
    legalManifestPda: PublicKey;
    explorerUrl: string;
  }> {
    const [attestationPda] = DPO2UHiroshimaClient.derivePda(
      args.attestor,
      args.aiSystemId,
      args.attestationType,
    );

    const { DPO2ULegalManifestClient } = await import('./legal-manifest.js');
    const [legalManifestPda] = DPO2ULegalManifestClient.derivePda(
      args.legalManifestJurisdiction,
    );

    const data = this.coder.instruction.encode('verify_against_legal_manifest', {});
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: attestationPda, isSigner: false, isWritable: false },
        { pubkey: legalManifestPda, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return {
      signature,
      attestationPda,
      legalManifestPda,
      explorerUrl: buildExplorerUrl(signature, this.cluster),
    };
  }

  /** Fetch + decode any HiroshimaAttestation account. */
  async fetchAttestation(attestationPda: PublicKey): Promise<any | null> {
    const info = await this.connection.getAccountInfo(attestationPda, 'confirmed');
    if (!info) return null;
    return this.coder.accounts.decode('HiroshimaAttestation', info.data);
  }

  // ─── Attestation submitters (5) — added 2026-05-15 ────────────────────────

  private async sendAttestationTx(
    ixName:
      | 'attest_caio_appointment'
      | 'submit_red_team_evidence'
      | 'commit_icoc_alignment'
      | 'submit_generic_attestation',
    attestationType: number,
    args: {
      aiSystemId: Uint8Array;
      evidenceHash: Uint8Array;
      validUntil?: number | bigint | null;
      storageUri?: string;
      attestationType?: number; // only for submit_generic
    },
  ): Promise<{ signature: string; attestationPda: PublicKey; explorerUrl: string }> {
    if (args.aiSystemId.length !== 32) throw new Error('aiSystemId must be 32 bytes');
    if (args.evidenceHash.length !== 32) throw new Error('evidenceHash must be 32 bytes');
    const [attestationPda] = DPO2UHiroshimaClient.derivePda(
      this.signer.publicKey,
      args.aiSystemId,
      args.attestationType ?? attestationType,
    );
    const payload: Record<string, unknown> = {
      ai_system_id: Array.from(args.aiSystemId),
      evidence_hash: Array.from(args.evidenceHash),
      valid_until: args.validUntil ?? null,
      storage_uri: args.storageUri ?? '',
    };
    if (ixName === 'submit_generic_attestation') {
      payload.attestation_type = args.attestationType ?? attestationType;
    }
    const data = this.coder.instruction.encode(ixName, payload);
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, attestationPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async attestCaioAppointment(args: {
    aiSystemId: Uint8Array;
    evidenceHash: Uint8Array;
    validUntil?: number | bigint | null;
    storageUri?: string;
  }) {
    return this.sendAttestationTx('attest_caio_appointment', HIROSHIMA_ATTESTATION_TYPE.CAIO, args);
  }

  async submitRedTeamEvidence(args: {
    aiSystemId: Uint8Array;
    evidenceHash: Uint8Array;
    validUntil?: number | bigint | null;
    storageUri?: string;
  }) {
    return this.sendAttestationTx(
      'submit_red_team_evidence',
      HIROSHIMA_ATTESTATION_TYPE.RED_TEAM,
      args,
    );
  }

  async commitIcocAlignment(args: {
    aiSystemId: Uint8Array;
    evidenceHash: Uint8Array;
    validUntil?: number | bigint | null;
    storageUri?: string;
  }) {
    return this.sendAttestationTx('commit_icoc_alignment', HIROSHIMA_ATTESTATION_TYPE.ICOC, args);
  }

  async submitGenericAttestation(args: {
    aiSystemId: Uint8Array;
    evidenceHash: Uint8Array;
    attestationType: number;
    validUntil?: number | bigint | null;
    storageUri?: string;
  }) {
    if (
      ![
        HIROSHIMA_ATTESTATION_TYPE.DATA_QUALITY,
        HIROSHIMA_ATTESTATION_TYPE.AIBOG,
        HIROSHIMA_ATTESTATION_TYPE.RED_LINE_NEGATIVE,
        HIROSHIMA_ATTESTATION_TYPE.HRIA,
        HIROSHIMA_ATTESTATION_TYPE.INCIDENT,
      ].includes(args.attestationType as any)
    ) {
      throw new Error(
        `submit_generic_attestation only accepts types 4 (DATA_QUALITY), 5 (AIBOG), 6 (RED_LINE_NEGATIVE), 7 (HRIA), 8 (INCIDENT); got ${args.attestationType}`,
      );
    }
    return this.sendAttestationTx(
      'submit_generic_attestation',
      args.attestationType,
      args,
    );
  }

  // ─── Revocation + rapporteur governance (3) ────────────────────────────────

  async revokeAttestation(args: {
    attestor: PublicKey;
    aiSystemId: Uint8Array;
    attestationType: number;
    reason: string;
    isTerminationOrder?: boolean;
  }): Promise<{ signature: string; explorerUrl: string }> {
    if (args.reason.length > 64) throw new Error('reason must be ≤ 64 bytes');
    const [attestationPda] = DPO2UHiroshimaClient.derivePda(
      args.attestor,
      args.aiSystemId,
      args.attestationType,
    );
    const data = this.coder.instruction.encode('revoke_attestation', {
      reason: args.reason,
      is_termination_order: args.isTerminationOrder ?? false,
    });
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: attestationPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  /** Rapporteur singleton PDA — seeds = [b"rapporteur_config"]. */
  static deriveRapporteurConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('rapporteur_config')],
      HIROSHIMA_AI_PROCESS_PROGRAM_ID,
    );
  }

  async initializeRapporteurConfig(): Promise<{ signature: string; configPda: PublicKey; explorerUrl: string }> {
    const [configPda] = DPO2UHiroshimaClient.deriveRapporteurConfigPda();
    const data = this.coder.instruction.encode('initialize_rapporteur_config', {});
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, configPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async updateRapporteurAuthority(newAuthority: PublicKey): Promise<{ signature: string; explorerUrl: string }> {
    const [configPda] = DPO2UHiroshimaClient.deriveRapporteurConfigPda();
    const data = this.coder.instruction.encode('update_rapporteur_authority', {
      new_authority: newAuthority,
    });
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }

  async flagTerminationObligation(args: {
    aiSystemId: Uint8Array;
    reason: string;
    evidenceHash: Uint8Array;
    redLineCategory: number;
  }): Promise<{ signature: string; terminationOrderPda: PublicKey; explorerUrl: string }> {
    if (args.aiSystemId.length !== 32) throw new Error('aiSystemId must be 32 bytes');
    if (args.evidenceHash.length !== 32) throw new Error('evidenceHash must be 32 bytes');
    if (args.reason.length > 128) throw new Error('reason must be ≤ 128 bytes');
    if (args.redLineCategory < 1 || args.redLineCategory > 12) {
      throw new Error('redLineCategory must be 1..=12 (CAIDP-UG canonical)');
    }
    const [configPda] = DPO2UHiroshimaClient.deriveRapporteurConfigPda();
    const [terminationOrderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('termination_order'), Buffer.from(args.aiSystemId)],
      HIROSHIMA_AI_PROCESS_PROGRAM_ID,
    );
    const data = this.coder.instruction.encode('flag_termination_obligation', {
      ai_system_id: Array.from(args.aiSystemId),
      reason: args.reason,
      evidence_hash: Array.from(args.evidenceHash),
      red_line_category: args.redLineCategory,
    });
    const ix = new TransactionInstruction({
      programId: HIROSHIMA_AI_PROCESS_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: terminationOrderPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit }))
      .add(ix);
    tx.feePayer = this.signer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    return { signature, terminationOrderPda, explorerUrl: buildExplorerUrl(signature, this.cluster) };
  }
}
