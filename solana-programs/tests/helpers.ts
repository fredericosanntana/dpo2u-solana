/**
 * Shared helpers for Sprint 3 scaffold tests.
 *
 * Program IDs kept in sync with each program's `declare_id!()` + Anchor.toml.
 * Any drift here causes test failure — acts as a canary.
 */

import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  compliance_registry: new PublicKey('7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK'),
  compliance_registry_pinocchio: new PublicKey('FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8'),
  agent_registry: new PublicKey('5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7'),
  payment_gateway: new PublicKey('4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q'),
  fee_distributor: new PublicKey('88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x'),
  agent_wallet_factory: new PublicKey('AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in'),
  consent_manager: new PublicKey('D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB'),
  art_vault: new PublicKey('C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna'),
  aiverify_attestation: new PublicKey('DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm'),
  // -- 4 jurisdiction-specific programs (deployed devnet 2026-05-01) --
  popia_info_officer_registry: new PublicKey('ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb'),
  ccpa_optout_registry: new PublicKey('5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk'),
  pipeda_consent_extension: new PublicKey('G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT'),
  pipa_korea_zk_identity: new PublicKey('41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR'),
  // -- Sprint E (built 2026-05-04, deploy devnet pendente) --
  hiroshima_ai_process_attestation: new PublicKey('4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx'),
} as const;

// -- PDA derivers (must match the seeds in the Rust programs) --

export function deriveAttestationPda(subject: PublicKey, commitment: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), subject.toBuffer(), Buffer.from(commitment)],
    PROGRAM_IDS.compliance_registry,
  );
}

/** Same seeds as Anchor, different program ID. Pinocchio port uses identical PDA derivation. */
export function deriveAttestationPdaPinocchio(
  subject: PublicKey,
  commitment: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), subject.toBuffer(), Buffer.from(commitment)],
    PROGRAM_IDS.compliance_registry_pinocchio,
  );
}

// -- Manual Borsh encoder for the Pinocchio program --
// The Pinocchio program has no IDL — args are raw Borsh after a 1-byte selector.
// Format specs: https://borsh.io/

function encodeBorshU32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function encodeBorshString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([encodeBorshU32LE(bytes.length), bytes]);
}

function encodeBorshVecU8(bytes: Buffer | Uint8Array): Buffer {
  const b = Buffer.from(bytes);
  return Buffer.concat([encodeBorshU32LE(b.length), b]);
}

function encodeBorshOptionI64(v: bigint | null): Buffer {
  if (v === null) return Buffer.from([0]);
  const inner = Buffer.alloc(8);
  inner.writeBigInt64LE(v, 0);
  return Buffer.concat([Buffer.from([1]), inner]);
}

export const pinocchioIx = {
  createAttestation(args: {
    commitment: Buffer;
    storageUri: string;
    schemaId: PublicKey;
    expiresAt: bigint | null;
  }): Buffer {
    return Buffer.concat([
      Buffer.from([0x00]),
      args.commitment,
      encodeBorshString(args.storageUri),
      args.schemaId.toBuffer(),
      encodeBorshOptionI64(args.expiresAt),
    ]);
  },

  createVerifiedAttestation(args: {
    commitment: Buffer;
    proof: Buffer;
    publicInputs: Buffer;
    storageUri: string;
    schemaId: PublicKey;
    expiresAt: bigint | null;
  }): Buffer {
    return Buffer.concat([
      Buffer.from([0x01]),
      args.commitment,
      encodeBorshVecU8(args.proof),
      encodeBorshVecU8(args.publicInputs),
      encodeBorshString(args.storageUri),
      args.schemaId.toBuffer(),
      encodeBorshOptionI64(args.expiresAt),
    ]);
  },

  revokeAttestation(args: { reason: string }): Buffer {
    return Buffer.concat([
      Buffer.from([0x02]),
      encodeBorshString(args.reason),
    ]);
  },

  // ---------------------------------------------------------------------------
  // Composed Stack (selectors 0x03 / 0x04) — ZK Compression flow
  // ---------------------------------------------------------------------------

  submitVerifiedCompressed(args: {
    subject: Buffer;          // 32 bytes
    commitment: Buffer;       // 32 bytes
    proof: Buffer;            // 356 bytes (SP1 v6)
    publicInputs: Buffer;     // 96 bytes
    payloadHash: Buffer;      // 32 bytes (SHA-256 do payload Shadow Drive)
    shdwUrl: Buffer;          // EXATAMENTE 96 bytes (padded com zero à direita)
    jurisdiction: number;     // 0..14
    authority: Buffer;        // 32 bytes (Squads vault[3] PDA)
    expiresAt: bigint;        // i64 (use 0x7fffffffffffffffn pra never-expires)
  }): Buffer {
    if (args.subject.length !== 32) throw new Error(`subject must be 32 bytes, got ${args.subject.length}`);
    if (args.commitment.length !== 32) throw new Error('commitment must be 32 bytes');
    if (args.payloadHash.length !== 32) throw new Error('payloadHash must be 32 bytes');
    if (args.shdwUrl.length !== 96) throw new Error('shdwUrl must be 96 bytes (right-padded)');
    if (args.authority.length !== 32) throw new Error('authority must be 32 bytes');

    const expiresBuf = Buffer.alloc(8);
    expiresBuf.writeBigInt64LE(args.expiresAt, 0);

    return Buffer.concat([
      Buffer.from([0x03]),
      args.subject,
      args.commitment,
      encodeBorshVecU8(args.proof),
      encodeBorshVecU8(args.publicInputs),
      args.payloadHash,
      args.shdwUrl,
      Buffer.from([args.jurisdiction]),
      args.authority,
      expiresBuf,
    ]);
  },

  revokeCompressed(args: {
    oldLeaf: Buffer;          // 251 bytes serializados (use serializeAttestationLeaf)
    revokeReason: number;     // 0..255
    expectedOldLeafHash: Buffer; // 32 bytes
  }): Buffer {
    if (args.oldLeaf.length !== 251) throw new Error(`oldLeaf must be 251 bytes, got ${args.oldLeaf.length}`);
    if (args.expectedOldLeafHash.length !== 32) throw new Error('expectedOldLeafHash must be 32 bytes');
    return Buffer.concat([
      Buffer.from([0x04]),
      encodeBorshVecU8(args.oldLeaf),
      Buffer.from([args.revokeReason]),
      args.expectedOldLeafHash,
    ]);
  },
};

// =============================================================================
// AttestationLeaf — TS replica of the Rust struct in
// programs/compliance-registry-pinocchio/src/lib.rs (must stay byte-identical
// to keep leaf hashes consistent across client and on-chain).
//
// Layout (252 bytes total, fixed-size, no Vec/String):
//   offset  size  field
//   ------  ----  -----
//      0    32    subject
//     32    32    commitment
//     64    32    payload_hash
//     96    96    shdw_url
//    192     1    jurisdiction
//    193    32    authority
//    225     1    status            (0=Active, 1=Revoked, 2=Expired)
//    226     8    issued_at         (i64 LE)
//    234     8    expires_at        (i64 LE)
//    242     8    revoked_at        (i64 LE)
//    250     1    revoke_reason
//    251     1    schema_version    (= 1 atualmente)
//   total: 252 bytes
// =============================================================================

export interface AttestationLeaf {
  subject: Buffer;        // 32
  commitment: Buffer;     // 32
  payloadHash: Buffer;    // 32
  shdwUrl: Buffer;        // 96 (right-padded zeros)
  jurisdiction: number;   // u8
  authority: Buffer;      // 32
  status: number;         // u8 (0/1/2)
  issuedAt: bigint;       // i64
  expiresAt: bigint;      // i64
  revokedAt: bigint;      // i64
  revokeReason: number;   // u8
  schemaVersion: number;  // u8 (= 1)
}

export const ATTESTATION_LEAF_SIZE = 252;
export const LEAF_STATUS_ACTIVE = 0;
export const LEAF_STATUS_REVOKED = 1;
export const LEAF_STATUS_EXPIRED = 2;
export const LEAF_SCHEMA_VERSION_V1 = 1;

export function serializeAttestationLeaf(leaf: AttestationLeaf): Buffer {
  if (leaf.subject.length !== 32) throw new Error('subject must be 32 bytes');
  if (leaf.commitment.length !== 32) throw new Error('commitment must be 32 bytes');
  if (leaf.payloadHash.length !== 32) throw new Error('payloadHash must be 32 bytes');
  if (leaf.shdwUrl.length !== 96) throw new Error('shdwUrl must be 96 bytes');
  if (leaf.authority.length !== 32) throw new Error('authority must be 32 bytes');

  const buf = Buffer.alloc(ATTESTATION_LEAF_SIZE);
  let o = 0;
  leaf.subject.copy(buf, o); o += 32;
  leaf.commitment.copy(buf, o); o += 32;
  leaf.payloadHash.copy(buf, o); o += 32;
  leaf.shdwUrl.copy(buf, o); o += 96;
  buf.writeUInt8(leaf.jurisdiction, o); o += 1;
  leaf.authority.copy(buf, o); o += 32;
  buf.writeUInt8(leaf.status, o); o += 1;
  buf.writeBigInt64LE(leaf.issuedAt, o); o += 8;
  buf.writeBigInt64LE(leaf.expiresAt, o); o += 8;
  buf.writeBigInt64LE(leaf.revokedAt, o); o += 8;
  buf.writeUInt8(leaf.revokeReason, o); o += 1;
  buf.writeUInt8(leaf.schemaVersion, o); o += 1;

  if (o !== ATTESTATION_LEAF_SIZE) throw new Error(`leaf serialization off-by: ${o} vs ${ATTESTATION_LEAF_SIZE}`);
  return buf;
}

export function computeLeafHash(leaf: AttestationLeaf): Buffer {
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(serializeAttestationLeaf(leaf)).digest();
}

export function deriveAgentPda(authority: PublicKey, name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), authority.toBuffer(), Buffer.from(name, 'utf8')],
    PROGRAM_IDS.agent_registry,
  );
}

export function deriveInvoicePda(payer: PublicKey, toolName: string, nonce: bigint): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), payer.toBuffer(), Buffer.from(toolName, 'utf8'), nonceBuf],
    PROGRAM_IDS.payment_gateway,
  );
}

export function deriveFeeConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_IDS.fee_distributor);
}

export function deriveAgentWalletPda(agentSeed: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_wallet'), Buffer.from(agentSeed)],
    PROGRAM_IDS.agent_wallet_factory,
  );
}

export function deriveConsentPda(
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
    PROGRAM_IDS.consent_manager,
  );
}

export function deriveArtVaultPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('art_vault'), authority.toBuffer()],
    PROGRAM_IDS.art_vault,
  );
}

export function deriveAiverifyPda(modelHash: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('aiverify'), Buffer.from(modelHash)],
    PROGRAM_IDS.aiverify_attestation,
  );
}

// -- 4 jurisdiction-specific PDA derivers (Sprint D programs) --

export function derivePopiaIoPda(
  responsibleParty: PublicKey,
  organizationIdHash: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('popia_io'), responsibleParty.toBuffer(), Buffer.from(organizationIdHash)],
    PROGRAM_IDS.popia_info_officer_registry,
  );
}

export function deriveCcpaOptoutPda(
  business: PublicKey,
  consumerCommitmentHash: Uint8Array,
  optoutKind: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('ccpa_optout'),
      business.toBuffer(),
      Buffer.from(consumerCommitmentHash),
      Buffer.from([optoutKind]),
    ],
    PROGRAM_IDS.ccpa_optout_registry,
  );
}

export function derivePipedaConsentPda(
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
    PROGRAM_IDS.pipeda_consent_extension,
  );
}

export function derivePipaZkIdentityPda(
  attestor: PublicKey,
  subjectCommitment: Uint8Array,
  attributeKind: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('pipa_zk_id'),
      attestor.toBuffer(),
      Buffer.from(subjectCommitment),
      Buffer.from([attributeKind]),
    ],
    PROGRAM_IDS.pipa_korea_zk_identity,
  );
}

// Sprint E — Hiroshima AI Process attestation PDA derivation.
// 5 attestation types: 1=caio, 2=red_team, 3=icoc, 4=data_quality, 5=aibog.
export function deriveHiroshimaAttestationPda(
  attestor: PublicKey,
  aiSystemId: Uint8Array,
  attestationType: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('hiroshima_ai'),
      attestor.toBuffer(),
      Buffer.from(aiSystemId),
      Buffer.from([attestationType]),
    ],
    PROGRAM_IDS.hiroshima_ai_process_attestation,
  );
}

// -- Fixtures --

export function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
