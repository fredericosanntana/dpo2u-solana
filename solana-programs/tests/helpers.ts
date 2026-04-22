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
};

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

// -- Fixtures --

export function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
