/**
 * Shared helpers for Sprint 3 scaffold tests.
 *
 * Program IDs kept in sync with each program's `declare_id!()` + Anchor.toml.
 * Any drift here causes test failure — acts as a canary.
 */

import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  compliance_registry: new PublicKey('7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK'),
  agent_registry: new PublicKey('5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7'),
  payment_gateway: new PublicKey('4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q'),
  fee_distributor: new PublicKey('88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x'),
  agent_wallet_factory: new PublicKey('AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in'),
} as const;

// -- PDA derivers (must match the seeds in the Rust programs) --

export function deriveAttestationPda(subject: PublicKey, commitment: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), subject.toBuffer(), Buffer.from(commitment)],
    PROGRAM_IDS.compliance_registry,
  );
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

// -- Fixtures --

export function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
