/**
 * composed.ts — Composed Stack Fase 3
 *
 * One-shot orchestrator for the DPO2U Composed flow. Compõe os 4 primitives:
 *
 *   1. Shadow Drive — upload payload imutável (DPIA, evidence, anexos)
 *   2. Pinocchio program — orquestra SP1 verify + leaf build
 *   3. Light Protocol — insere AttestationLeaf compressed na CMT
 *   4. Squads v4 vault PDA — gravado como leaf.authority pra revoke
 *
 * Uma única tx atômica devnet — só falha se algum passo falhar; rent-locked
 * accounts não são criadas em caso de revert.
 *
 * Status Fase 3: a tx ainda não inclui a CPI Light Protocol real porque:
 *   (a) o programa Pinocchio tem stubs em cpi_light_insert_leaf
 *   (b) o cliente Light Protocol API é validada em runtime (init-cmt.ts)
 *
 * Fase 3.b finaliza substituindo `light_program: null` por accounts reais
 * + instruction wire encoding final.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";

import { PhotonClient } from "./photon.js";
import { StorageBackend } from "./storage/types.js";

/** Pinocchio compliance-registry-pinocchio program ID. */
export const COMPLIANCE_PINOCCHIO_PROGRAM_ID = new PublicKey(
  "FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8",
);

/** SP1 Groth16 verifier program ID (deployed devnet + mainnet). */
export const SP1_VERIFIER_PROGRAM_ID = new PublicKey(
  "5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW",
);

/** Light System Program ID (constant across clusters). */
export const LIGHT_SYSTEM_PROGRAM_ID = new PublicKey(
  "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
);

/** Light Account Compression Program (manages the actual Merkle trees). */
export const LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey(
  "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
);

/**
 * Derive `account_compression_authority` PDA — the CPI signer authority pra
 * o invoking program (compliance-registry-pinocchio). Seeds: [b"cpi_authority"].
 *
 * Reference: programs/account-compression/src/utils/constants.rs
 *   `pub const CPI_AUTHORITY_PDA_SEED: &[u8] = b"cpi_authority";`
 */
export function deriveAccountCompressionAuthority(
  invokingProgram: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cpi_authority")],
    invokingProgram,
  )[0];
}

/**
 * Derive `registered_program_pda` — PDA owned by account-compression that
 * proves invokingProgram has been registered as a trusted CPI source.
 *
 * Seeds: [&program_to_be_registered.key().to_bytes()]
 * Owner: ACCOUNT_COMPRESSION_PROGRAM_ID
 *
 * IMPORTANT: this PDA must already exist on-chain (created via
 * register_program instruction). For DPO2U pre-mainnet, this is a
 * blocker — see /root/dpo2u-solana/docs/GOVERNANCE.md Light Protocol section.
 */
export function deriveRegisteredProgramPda(invokingProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [invokingProgram.toBuffer()],
    LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID,
  )[0];
}

export const SHDW_URL_BYTES = 96;

export type Jurisdiction =
  | "lgpd" | "gdpr" | "ccpa" | "pipeda" | "law25"
  | "popia" | "ndpa" | "uae" | "pdpa" | "pdp"
  | "pipa" | "dpdp" | "appi" | "micar" | "ai-governance";

const JURISDICTION_TO_CODE: Record<Jurisdiction, number> = {
  lgpd: 0, gdpr: 1, ccpa: 2, pipeda: 3, law25: 4,
  popia: 5, ndpa: 6, uae: 7, pdpa: 8, pdp: 9,
  pipa: 10, dpdp: 11, appi: 12, micar: 13, "ai-governance": 14,
};

export interface ComposedAttestationParams {
  /** SP1 proof bytes (356) */
  proof: Buffer;
  /** SP1 public inputs (96) */
  publicInputs: Buffer;
  /** Subject pubkey (whose attestation this is) */
  subject: PublicKey;
  /** ZK commitment — must match publicInputs[32..64] */
  commitment: Buffer;
  /** Payload integral (DPIA PDF, evidence JSON, etc.) */
  payload: Buffer | Uint8Array;
  /** Filename pra Shadow Drive (deve incluir extensão) */
  payloadFilename: string;
  /** Jurisdição alvo (LGPD, GDPR, MiCAR, etc.) */
  jurisdiction: Jurisdiction;
  /** Squads vault PDA que poderá revocar essa attestation */
  authority: PublicKey;
  /** Expiração Unix timestamp; null = no expiry (i64 max) */
  expiresAt?: bigint | null;
  /** Storage backend (ShdwDriveBackend pra mainnet, MockBackend pra devnet) */
  storage: StorageBackend;
  /** Photon Indexer client (Helius managed default) */
  photon: PhotonClient;
  /** State Tree Pubkey (alocada em init-cmt.ts) */
  stateTree: PublicKey;
  /** Output Queue Pubkey (paired with stateTree) */
  stateQueue: PublicKey;
  /** Solana RPC connection */
  connection: Connection;
  /** Payer keypair (assina e paga a tx) */
  payer: Keypair;
}

export interface ComposedAttestationResult {
  txSignature: string;
  shdwUrl: string;
  payloadHash: Buffer;
  leafHash: Buffer;
  jurisdictionCode: number;
}

/**
 * Submits one composed attestation in a single atomic tx.
 *
 * Pre-conditions:
 *   - Subject + payload available off-chain
 *   - SP1 proof generated (caller responsibility — see SP1 prover docs)
 *   - State tree allocated (run init-cmt.ts first)
 *   - Storage account on Shadow Drive ready (or MockBackend pra devnet)
 *
 * Atomicity guarantees:
 *   - Tx atomic: revert if SP1 verify fails OR Light insert fails
 *   - Shadow Drive upload happens BEFORE tx; if tx reverts, payload remains
 *     in Shadow Drive (orphan — not catastrophic, but should be cleaned up
 *     periodically). Future improvement: compute hash, send tx with hash,
 *     upload only after tx confirms.
 */
export async function submitComposedAttestation(
  params: ComposedAttestationParams,
): Promise<ComposedAttestationResult> {
  const payloadBuf = Buffer.from(params.payload);

  // 1. Hash payload
  const payloadHash = createHash("sha256").update(payloadBuf).digest();

  // 2. Upload to Shadow Drive
  const shdwUrl = await params.storage.upload(payloadBuf, params.payloadFilename);
  if (shdwUrl.length > SHDW_URL_BYTES) {
    throw new Error(
      `Shadow Drive URL too long (${shdwUrl.length} > ${SHDW_URL_BYTES} bytes). ` +
        `Reduce filename or use a shorter gateway.`,
    );
  }

  // 3. Build shdw_url buffer (right-padded with zeros to fixed 96 bytes)
  const shdwUrlBuf = Buffer.alloc(SHDW_URL_BYTES, 0);
  Buffer.from(shdwUrl, "utf8").copy(shdwUrlBuf);

  // 4. Get insertion proof from Photon (Fase 3.b will plug into ix accounts)
  const insertionProof = await params.photon.getInsertionProof(params.stateTree);

  // 5. Build instruction data: selector 0x03 + SubmitVerifiedCompressedArgs
  const expiresAt = params.expiresAt ?? null;
  const ixData = encodeSubmitVerifiedCompressed({
    subject: params.subject.toBuffer(),
    commitment: params.commitment,
    proof: params.proof,
    publicInputs: params.publicInputs,
    payloadHash,
    shdwUrl: shdwUrlBuf,
    jurisdiction: JURISDICTION_TO_CODE[params.jurisdiction],
    authority: params.authority.toBuffer(),
    expiresAt: expiresAt ?? 9223372036854775807n, // i64::MAX
  });

  // 6. Build accounts list. Layout aligned to Pinocchio handler in
  //    programs/compliance-registry-pinocchio/src/lib.rs (Fase 3.b layout):
  //
  //    Handler expects:
  //      [0] issuer (signer, writable) — pays tx + Light fees + acts as authority
  //      [1] verifier_program (SP1 Groth16)
  //      [2] clock_sysvar
  //      [3..16] light_accounts: target + 11 fixed + 1 state_tree (insert flow):
  //        [3]  LIGHT_SYSTEM_PROGRAM           (target of inner CPI)
  //        [4]  fee_payer (= issuer)            (signer, writable)
  //        [5]  authority (= issuer)            (signer)
  //        [6]  registered_program_pda          (PDA validated by Light)
  //        [7]  _noop (placeholder; legacy)     (SystemProgram OK)
  //        [8]  account_compression_authority   (PDA = ["cpi_authority"] @ pinocchio_pid)
  //        [9]  account_compression_program     (compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq)
  //        [10] invoking_program (= COMPLIANCE_PINOCCHIO_PROGRAM_ID)
  //        [11] sol_pool_pda Option=None placeholder
  //        [12] decompression_recipient Option=None placeholder
  //        [13] system_program (real 11111...)
  //        [14] cpi_context_account Option=None placeholder
  //        [15] state_tree (writable) — Light's remaining_accounts[0]
  //
  //    For revoke flow add state_queue at [16].
  const accountCompressionAuthority = deriveAccountCompressionAuthority(
    COMPLIANCE_PINOCCHIO_PROGRAM_ID,
  );
  const registeredProgramPda = deriveRegisteredProgramPda(
    COMPLIANCE_PINOCCHIO_PROGRAM_ID,
  );
  const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

  const ix = new TransactionInstruction({
    programId: COMPLIANCE_PINOCCHIO_PROGRAM_ID,
    keys: [
      // [0..2] Pinocchio handler-owned accounts
      { pubkey: params.payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SP1_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      // [3] Light System Program (CPI target)
      { pubkey: LIGHT_SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      // [4] fee_payer (= issuer) — signer + writable for Light fee debit
      { pubkey: params.payer.publicKey, isSigner: true, isWritable: true },
      // [5] authority (= issuer) — signer
      { pubkey: params.payer.publicKey, isSigner: true, isWritable: false },
      // [6] registered_program_pda
      { pubkey: registeredProgramPda, isSigner: false, isWritable: false },
      // [7] _noop placeholder
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      // [8] account_compression_authority
      { pubkey: accountCompressionAuthority, isSigner: false, isWritable: false },
      // [9] account_compression_program
      { pubkey: LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
      // [10] invoking_program (compliance-registry-pinocchio itself)
      { pubkey: COMPLIANCE_PINOCCHIO_PROGRAM_ID, isSigner: false, isWritable: false },
      // [11] sol_pool_pda placeholder
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      // [12] decompression_recipient placeholder
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      // [13] system_program
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      // [14] cpi_context_account placeholder
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      // [15] state_tree (Light remaining_accounts[0]) — writable
      { pubkey: params.stateTree, isSigner: false, isWritable: true },
      // [16] state_queue — writable (only used for revoke flow; harmless extra
      //      account in insert flow as Light skips remaining beyond what's needed).
      { pubkey: params.stateQueue, isSigner: false, isWritable: true },
    ],
    data: ixData,
  });

  // 7. Build tx with compute budget (350-400k CU expected for the full chain)
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ix,
  );

  const txSignature = await sendAndConfirmTransaction(
    params.connection,
    tx,
    [params.payer],
    { commitment: "confirmed", skipPreflight: false },
  );

  // 8. Compute leaf hash for return (same logic as Pinocchio program)
  const leafHash = computeLeafHashForReturn({
    subject: params.subject.toBuffer(),
    commitment: params.commitment,
    payloadHash,
    shdwUrl: shdwUrlBuf,
    jurisdiction: JURISDICTION_TO_CODE[params.jurisdiction],
    authority: params.authority.toBuffer(),
    expiresAt: expiresAt ?? 9223372036854775807n,
    txSignature,
    insertionProof,
  });

  return {
    txSignature,
    shdwUrl,
    payloadHash,
    leafHash,
    jurisdictionCode: JURISDICTION_TO_CODE[params.jurisdiction],
  };
}

// =============================================================================
// Internal — instruction encoding and leaf hash (TS replica of Rust struct)
// =============================================================================

interface SubmitArgs {
  subject: Buffer;        // 32
  commitment: Buffer;     // 32
  proof: Buffer;          // 356
  publicInputs: Buffer;   // 96
  payloadHash: Buffer;    // 32
  shdwUrl: Buffer;        // 96
  jurisdiction: number;   // 0..14
  authority: Buffer;      // 32
  expiresAt: bigint;      // i64
}

function encodeSubmitVerifiedCompressed(args: SubmitArgs): Buffer {
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(args.proof.length, 0);
  const inputsLen = Buffer.alloc(4);
  inputsLen.writeUInt32LE(args.publicInputs.length, 0);
  const expiresBuf = Buffer.alloc(8);
  expiresBuf.writeBigInt64LE(args.expiresAt, 0);

  return Buffer.concat([
    Buffer.from([0x03]),         // selector
    args.subject,
    args.commitment,
    proofLen, args.proof,
    inputsLen, args.publicInputs,
    args.payloadHash,
    args.shdwUrl,
    Buffer.from([args.jurisdiction]),
    args.authority,
    expiresBuf,
  ]);
}

interface LeafHashArgs {
  subject: Buffer;
  commitment: Buffer;
  payloadHash: Buffer;
  shdwUrl: Buffer;
  jurisdiction: number;
  authority: Buffer;
  expiresAt: bigint;
  txSignature: string;
  insertionProof: { leafIndex: number };
}

const LEAF_STATUS_ACTIVE = 0;
const LEAF_SCHEMA_VERSION_V1 = 1;

/**
 * Computes the AttestationLeaf hash matching the Rust struct in
 * compliance-registry-pinocchio. Note: client doesn't know the on-chain
 * `issued_at` (clock at execution) so we approximate with insertion proof
 * leafIndex for a heuristic — Fase 3.b reads back the actual leaf via Photon
 * after confirmation to get the canonical hash.
 *
 * For now this returns a "best-effort" hash for client UX; Photon is the
 * source of truth post-confirmation.
 */
function computeLeafHashForReturn(args: LeafHashArgs): Buffer {
  const buf = Buffer.alloc(252);
  let o = 0;
  args.subject.copy(buf, o); o += 32;
  args.commitment.copy(buf, o); o += 32;
  args.payloadHash.copy(buf, o); o += 32;
  args.shdwUrl.copy(buf, o); o += 96;
  buf.writeUInt8(args.jurisdiction, o); o += 1;
  args.authority.copy(buf, o); o += 32;
  buf.writeUInt8(LEAF_STATUS_ACTIVE, o); o += 1;
  // issued_at, expires_at, revoked_at: client placeholders (Photon will return canonical)
  buf.writeBigInt64LE(0n, o); o += 8;            // issued_at — unknown at this layer
  buf.writeBigInt64LE(args.expiresAt, o); o += 8;
  buf.writeBigInt64LE(0n, o); o += 8;            // revoked_at = 0 for new leaves
  buf.writeUInt8(0, o); o += 1;                   // revoke_reason
  buf.writeUInt8(LEAF_SCHEMA_VERSION_V1, o); o += 1;
  return createHash("sha256").update(buf).digest();
}
