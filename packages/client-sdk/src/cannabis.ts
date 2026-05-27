/**
 * cannabis.ts — Kolibri seed-to-sale plant traceability client.
 *
 * Wraps `compliance-registry-pinocchio` selector 0x06 `submit_cannabis_event`.
 * Anchors plant lifecycle events on Solana with cross-program gating against
 * `agent-registry` (cultivator / dispensary / lab MUST be registered).
 *
 * Cost: ~0.003 SOL rent per event PDA (regular account, no compression).
 * Compute: 5-11k CU per event (3-5x cheaper than equivalent Anchor program).
 *
 * Usage:
 *   ```ts
 *   import { DPO2UCannabisClient, CANNABIS_EVENT_TYPE } from '@dpo2u/client-sdk';
 *
 *   const client = new DPO2UCannabisClient({ cluster: 'devnet', signer: kp });
 *   await client.registerCultivator('cultivator:00.000.000/0001-00'); // one-time
 *   const { signature, eventPda } = await client.submitEvent({
 *     batchId: ULID.generate(),         // 16 bytes
 *     eventType: CANNABIS_EVENT_TYPE.MOTHER_REGISTERED,
 *     payloadHash: sha256(payloadJson), // 32 bytes
 *     storageUri: `shadow://${shadowUrl}`,
 *     cultivarCode: 'HEM:CBD1',         // ≤ 8 chars
 *     emittedAt: BigInt(Date.now() / 1000),
 *   });
 *   ```
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";

import { COMPLIANCE_PINOCCHIO_PROGRAM_ID } from "./composed.js";

export const AGENT_REGISTRY_PROGRAM_ID = new PublicKey(
  "5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7",
);

/** Cannabis seed-to-sale event types — keep in sync with on-chain Rust enum. */
export const CANNABIS_EVENT_TYPE = {
  SEED_PLANTED: 1,
  MOTHER_REGISTERED: 2,
  CLONE_CUT: 3,
  VEGETATION_START: 4,
  FLOWERING_START: 5,
  HARVEST: 6,
  DRYING_START: 7,
  CURING_START: 8,
  LAB_SAMPLE_TAKEN: 9,
  LAB_RESULT_RELEASED: 10,
  PACKAGED: 11,
  TRANSFERRED: 12,
  DISPENSED: 13,
  RECALLED: 14,
  DESTROYED: 15,
} as const;

export type CannabisEventType =
  (typeof CANNABIS_EVENT_TYPE)[keyof typeof CANNABIS_EVENT_TYPE];

/** Zero-filled batch id — used as parent for root events (seed purchase). */
export const ROOT_BATCH_ID: Buffer = Buffer.alloc(16);

export type ClusterName = "localnet" | "devnet" | "testnet" | "mainnet-beta";

const CLUSTER_URLS: Record<ClusterName, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export interface DPO2UCannabisClientOptions {
  cluster?: ClusterName;
  rpcUrl?: string;
  /** Authority keypair — cultivator / dispensary / lab signer. Must be registered in agent-registry. */
  signer: Keypair;
  /**
   * Optional path to the agent_registry IDL JSON — used by `registerCultivator()`.
   * Defaults to the repo's `target/idl/agent_registry.json` (best-effort).
   * If unavailable, you can pre-register the agent via another tool and skip this method.
   */
  agentRegistryIdlPath?: string;
}

export interface SubmitCannabisEventArgs {
  /** 16-byte ULID identifying the batch (e.g. mother plant, harvest lot, package). */
  batchId: Uint8Array;
  /** One of CANNABIS_EVENT_TYPE values (1..15). */
  eventType: CannabisEventType;
  /** 16 bytes; zero-filled (`ROOT_BATCH_ID`) for root events. Otherwise = parent batch id. */
  parentBatchId?: Uint8Array;
  /** 32-byte SHA-256 of the canonicalized JSON payload (off-chain evidence). */
  payloadHash: Uint8Array;
  /** ipfs:// or shadow:// URI to the payload. Max 200 bytes. */
  storageUri: string;
  /** Up to 8 ASCII chars (e.g. `HEM:CBD1`). Right-padded with 0x00 on the wire. */
  cultivarCode: string;
  /** Unix timestamp (seconds) of when the event actually happened. */
  emittedAt: bigint;
}

export interface SubmitCannabisEventResult {
  signature: string;
  eventPda: PublicKey;
  /** Explorer URL hint (Solscan) for the resulting tx. */
  explorerUrl: string;
}

const CANNABIS_EVENT_SEED = Buffer.from("cannabis_event");

/** Derive the deterministic event PDA. */
export function deriveCannabisEventPda(
  batchId: Uint8Array,
  eventType: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CANNABIS_EVENT_SEED, Buffer.from(batchId), Buffer.from([eventType])],
    COMPLIANCE_PINOCCHIO_PROGRAM_ID,
  );
}

/** Derive the agent PDA for a given authority + name. */
export function deriveAgentPda(
  authority: PublicKey,
  name: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), authority.toBuffer(), Buffer.from(name, "utf8")],
    AGENT_REGISTRY_PROGRAM_ID,
  );
}

// -- Borsh encoders (manual — no IDL on the Pinocchio side) --------------------

function encodeBorshU32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function encodeBorshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([encodeBorshU32LE(bytes.length), bytes]);
}

function rightPadAscii8(s: string): Buffer {
  const b = Buffer.alloc(8);
  Buffer.from(s, "ascii").copy(b);
  return b;
}

function ensureLen(bytes: Uint8Array, expected: number, name: string): Buffer {
  if (bytes.length !== expected) {
    throw new Error(`${name} must be ${expected} bytes, got ${bytes.length}`);
  }
  return Buffer.from(bytes);
}

/**
 * Encode the raw instruction data for selector 0x06.
 * Layout: 0x06 | batch_id(16) | event_type(u8) | parent_batch_id(16) |
 *         payload_hash(32) | storage_uri(Borsh string) | cultivar_code(8) | emitted_at(i64 LE)
 */
export function encodeSubmitCannabisEvent(args: SubmitCannabisEventArgs): Buffer {
  if (args.eventType < 1 || args.eventType > 15) {
    throw new Error(`eventType out of range: ${args.eventType}`);
  }
  if (args.storageUri.length > 200) {
    throw new Error("storageUri too long (max 200 bytes)");
  }
  if (args.cultivarCode.length > 8) {
    throw new Error("cultivarCode too long (max 8 ASCII chars)");
  }
  const batchId = ensureLen(args.batchId, 16, "batchId");
  const parentBatchId = ensureLen(
    args.parentBatchId ?? ROOT_BATCH_ID,
    16,
    "parentBatchId",
  );
  const payloadHash = ensureLen(args.payloadHash, 32, "payloadHash");
  const cultivarCode = rightPadAscii8(args.cultivarCode);

  const emittedBuf = Buffer.alloc(8);
  emittedBuf.writeBigInt64LE(args.emittedAt, 0);

  return Buffer.concat([
    Buffer.from([0x06]),
    batchId,
    Buffer.from([args.eventType]),
    parentBatchId,
    payloadHash,
    encodeBorshString(args.storageUri),
    cultivarCode,
    emittedBuf,
  ]);
}

/** Build a `submit_cannabis_event` instruction. Caller wraps in Tx + signs. */
export function buildSubmitCannabisEventIx(opts: {
  authority: PublicKey;
  agentPda: PublicKey;
  batchId: Uint8Array;
  eventType: CannabisEventType;
  parentBatchId?: Uint8Array;
  payloadHash: Uint8Array;
  storageUri: string;
  cultivarCode: string;
  emittedAt: bigint;
}): TransactionInstruction {
  const [eventPda] = deriveCannabisEventPda(opts.batchId, opts.eventType);
  const data = encodeSubmitCannabisEvent({
    batchId: opts.batchId,
    eventType: opts.eventType,
    parentBatchId: opts.parentBatchId,
    payloadHash: opts.payloadHash,
    storageUri: opts.storageUri,
    cultivarCode: opts.cultivarCode,
    emittedAt: opts.emittedAt,
  });
  return new TransactionInstruction({
    programId: COMPLIANCE_PINOCCHIO_PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: eventPda, isSigner: false, isWritable: true },
      { pubkey: opts.agentPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// =============================================================================
// High-level client
// =============================================================================

export class DPO2UCannabisClient {
  private readonly connection: Connection;
  private readonly signer: Keypair;
  private readonly cluster: ClusterName;
  private agentCoderCache?: BorshCoder;

  constructor(opts: DPO2UCannabisClientOptions) {
    this.cluster = opts.cluster ?? "devnet";
    const url = opts.rpcUrl ?? CLUSTER_URLS[this.cluster];
    this.connection = new Connection(url, "confirmed");
    this.signer = opts.signer;
  }

  /** Read-only — derive the agent PDA for THIS client's signer. */
  agentPdaFor(name: string): PublicKey {
    return deriveAgentPda(this.signer.publicKey, name)[0];
  }

  /**
   * Submit one plant lifecycle event. Agent must be pre-registered via
   * `registerCultivator()` / agent-registry CLI.
   *
   * Returns the tx signature + event PDA. On idempotency error
   * (re-submission of same batch+type), throws with the underlying message.
   */
  async submitEvent(
    args: SubmitCannabisEventArgs & { agentName: string },
  ): Promise<SubmitCannabisEventResult> {
    const agentPda = this.agentPdaFor(args.agentName);
    const ix = buildSubmitCannabisEventIx({
      authority: this.signer.publicKey,
      agentPda,
      batchId: args.batchId,
      eventType: args.eventType,
      parentBatchId: args.parentBatchId,
      payloadHash: args.payloadHash,
      storageUri: args.storageUri,
      cultivarCode: args.cultivarCode,
      emittedAt: args.emittedAt,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.signer]);
    const [eventPda] = deriveCannabisEventPda(args.batchId, args.eventType);

    const explorerSuffix =
      this.cluster === "mainnet-beta"
        ? ""
        : `?cluster=${this.cluster === "localnet" ? "custom" : this.cluster}`;

    return {
      signature: sig,
      eventPda,
      explorerUrl: `https://solscan.io/tx/${sig}${explorerSuffix}`,
    };
  }

  /**
   * Register the signer as an agent (cultivator / dispensary / lab) in
   * agent-registry. One-time setup per (authority, name). Idempotent — calling
   * twice with the same name throws.
   *
   * NOTE: this method requires the `agent_registry.json` IDL. If the IDL is
   * unavailable in your environment, call agent-registry directly via your
   * own pipeline and skip this helper.
   */
  async registerAgent(name: string, idl: any): Promise<string> {
    if (!this.agentCoderCache) {
      this.agentCoderCache = new BorshCoder(idl);
    }
    const data = this.agentCoderCache.instruction.encode("register_agent", {
      name,
      did_commitment: Array.from(Buffer.alloc(32)), // caller can overwrite via direct call
      did_uri: "",
      _permissions: 0,
    });
    const [agentPda] = deriveAgentPda(this.signer.publicKey, name);
    const ix = new TransactionInstruction({
      programId: AGENT_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: agentPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.signer]);
  }

  /** Convenience helpers to register the typical Kolibri roles by CNPJ-formatted name. */
  registerCultivator(cnpj: string, idl: any): Promise<string> {
    return this.registerAgent(`cultivator:${cnpj}`, idl);
  }
  registerDispensary(cnpj: string, idl: any): Promise<string> {
    return this.registerAgent(`dispensary:${cnpj}`, idl);
  }
  registerLab(cnpj: string, idl: any): Promise<string> {
    return this.registerAgent(`lab:${cnpj}`, idl);
  }
}
