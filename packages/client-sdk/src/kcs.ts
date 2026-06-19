/**
 * kcs.ts — Kolibri Score (KCS) client.
 *
 * Wraps `compliance-registry-pinocchio` selector 0x07 `submit_kcs_snapshot`:
 * a monthly operational-health snapshot per tenant, with a Poseidon (BN254)
 * commitment computed off-chain and stored on-chain. Anyone can recompute the
 * commitment from the published scores to verify it (KNECT/ERP WP §04
 * "verificável por qualquer parte"). On-chain Poseidon verification via the
 * sol_poseidon syscall is a hardening follow-up; today the program only stores.
 *
 * Components (each normalized to 0..10_000 bps), weighted into the composite:
 *   tx volume 30% · dispensing time 25% · time in protocol 20% ·
 *   cancellation rate 15% · Cloak adoption 10%
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { buildPoseidon, type Poseidon } from "circomlibjs";

import { COMPLIANCE_PINOCCHIO_PROGRAM_ID } from "./composed.js";

export const KCS_SNAPSHOT_SEED = Buffer.from("kcs_snapshot");
export const KCS_COMPONENTS = 5;
export const KCS_SCORE_MAX = 10_000;

/** Component weights in bps (sum = 10_000). ORDER is canonical and must match
 *  `scoresToArray` + the on-chain scores[5] order. */
export const KCS_COMPONENT_WEIGHTS = [3000, 2500, 2000, 1500, 1000] as const;

export interface KcsScores {
  /** On-chain transaction volume (30%). */
  txVolume: number;
  /** Average dispensing time (25%). */
  dispensingTime: number;
  /** Time in protocol (20%). */
  timeInProtocol: number;
  /** Cancellation / refund rate (15%). */
  cancellationRate: number;
  /** Cloak privacy adoption (10%). */
  cloakAdoption: number;
}

/** Canonical component order — matches KCS_COMPONENT_WEIGHTS and on-chain scores[5]. */
export function scoresToArray(s: KcsScores): number[] {
  return [s.txVolume, s.dispensingTime, s.timeInProtocol, s.cancellationRate, s.cloakAdoption];
}

/** Weighted composite (bps) from the 5 components. Floor division. */
export function computeComposite(s: KcsScores): number {
  const arr = scoresToArray(s);
  let acc = 0;
  for (let i = 0; i < KCS_COMPONENTS; i++) acc += arr[i]! * KCS_COMPONENT_WEIGHTS[i]!;
  return Math.floor(acc / 10_000);
}

/** KCS snapshot PDA — one per (tenant, period). Mirrors the Rust seeds. */
export function deriveKcsSnapshotPda(tenant: PublicKey, period: number): [PublicKey, number] {
  const periodBuf = Buffer.alloc(4);
  periodBuf.writeUInt32LE(period, 0);
  return PublicKey.findProgramAddressSync(
    [KCS_SNAPSHOT_SEED, tenant.toBuffer(), periodBuf],
    COMPLIANCE_PINOCCHIO_PROGRAM_ID,
  );
}

// -- Poseidon commitment (BN254) ---------------------------------------------

let _poseidon: Poseidon | null = null;
async function getPoseidon(): Promise<Poseidon> {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

function bigToBe32(big: bigint): Buffer {
  const hex = big.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("commitment exceeds 32 bytes");
  return Buffer.from(hex, "hex");
}

export interface KcsCommitmentInput {
  tenant: PublicKey;
  period: number;
  scores: KcsScores;
  composite: number;
}

/**
 * Poseidon(tenantHi, tenantLo, period, s0..s4, composite) → 32-byte BE buffer.
 * The 32-byte tenant pubkey is split into two 128-bit limbs to stay below the
 * BN254 field modulus. Deterministic — the public verifier recomputes this.
 */
export async function computeKcsCommitment(input: KcsCommitmentInput): Promise<Buffer> {
  const poseidon = await getPoseidon();
  const t = input.tenant.toBuffer();
  const tenantHi = BigInt("0x" + t.subarray(0, 16).toString("hex"));
  const tenantLo = BigInt("0x" + t.subarray(16, 32).toString("hex"));
  const arr = scoresToArray(input.scores).map((n) => BigInt(n));
  const inputs = [tenantHi, tenantLo, BigInt(input.period), ...arr, BigInt(input.composite)];
  const h = poseidon(inputs);
  return bigToBe32(poseidon.F.toObject(h));
}

// -- Borsh encoder (selector 0x07) -------------------------------------------

function encodeBorshU32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function encodeBorshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([encodeBorshU32LE(bytes.length), bytes]);
}

export interface SubmitKcsSnapshotArgs {
  tenant: PublicKey;
  /** yyyymm, e.g. 202606. */
  period: number;
  /** 32-byte Poseidon commitment (see computeKcsCommitment). */
  kcsCommitment: Uint8Array;
  scores: KcsScores;
  composite: number;
  /** ipfs:// or shadow:// URI to the published score breakdown. Max 200 bytes. */
  storageUri: string;
}

/**
 * Encode raw instruction data for selector 0x07. Layout:
 *   0x07 | tenant(32) | period(u32 LE) | commitment(32) |
 *   scores[5](u32 LE each) | composite(u32 LE) | storage_uri(Borsh string)
 */
export function encodeSubmitKcsSnapshot(args: SubmitKcsSnapshotArgs): Buffer {
  if (args.kcsCommitment.length !== 32) throw new Error("kcsCommitment must be 32 bytes");
  if (args.storageUri.length > 200) throw new Error("storageUri too long (max 200 bytes)");
  const arr = scoresToArray(args.scores);
  if (arr.some((s) => s < 0 || s > KCS_SCORE_MAX)) throw new Error("score component out of bounds (0..10000)");
  if (args.composite < 0 || args.composite > KCS_SCORE_MAX) throw new Error("composite out of bounds (0..10000)");

  return Buffer.concat([
    Buffer.from([0x07]),
    args.tenant.toBuffer(),
    encodeBorshU32LE(args.period),
    Buffer.from(args.kcsCommitment),
    Buffer.concat(arr.map(encodeBorshU32LE)),
    encodeBorshU32LE(args.composite),
    encodeBorshString(args.storageUri),
  ]);
}

/** Build a `submit_kcs_snapshot` instruction. The authority (KCS worker) must
 *  be a registered agent; pass its agent PDA. Caller wraps in Tx + signs. */
export function buildSubmitKcsSnapshotIx(opts: {
  authority: PublicKey;
  agentPda: PublicKey;
  args: SubmitKcsSnapshotArgs;
}): TransactionInstruction {
  const [snapshotPda] = deriveKcsSnapshotPda(opts.args.tenant, opts.args.period);
  return new TransactionInstruction({
    programId: COMPLIANCE_PINOCCHIO_PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: snapshotPda, isSigner: false, isWritable: true },
      { pubkey: opts.agentPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: encodeSubmitKcsSnapshot(opts.args),
  });
}
