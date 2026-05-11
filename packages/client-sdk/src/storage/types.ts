/**
 * Storage backend interface — pluggable off-chain storage for attestation
 * payloads. The Solana `compliance_registry` stores only a 32-byte commitment
 * hash + a free-form `storage_uri: String`. Backends decide where the raw
 * payload (proof, public values, consent docs) actually lives.
 *
 * # LGPD Art. 18 relevance
 *
 * The on-chain commitment is irreversibly hashed PII — deleting it is neither
 * possible nor necessary. The OFF-CHAIN payload is where actual personal data
 * may live; to honor the right to erasure, the backend must support `delete`.
 *
 * Backend matrix:
 *   mock  — in-memory, test-only; full CRUD.
 *   ipfs  — read-only placeholder (public gateway), no auth to upload/delete.
 *   shdw  — Shadow Drive v1 (mainnet-only), full CRUD, LGPD-compliant.
 */

export interface StorageBackend {
  /** Uploads `content` with suggested `name` and returns a resolvable URI. */
  upload(content: Uint8Array, name: string): Promise<string>;

  /** Deletes the payload at `uri`. Noop if already gone. LGPD erasure exit. */
  delete(uri: string): Promise<void>;

  /** Fetches the raw bytes at `uri`. Throws if not found or unreadable. */
  fetch(uri: string): Promise<Uint8Array>;

  /** Backend identifier for logs/pitch output. */
  readonly kind: 'mock' | 'ipfs' | 'shdw';
}

export class NotImplementedError extends Error {
  constructor(backend: string, op: string) {
    super(`${backend} backend does not support ${op}`);
    this.name = 'NotImplementedError';
  }
}

export class PayloadNotFoundError extends Error {
  constructor(uri: string) {
    super(`payload not found at ${uri}`);
    this.name = 'PayloadNotFoundError';
  }
}
