/**
 * EncryptedStorageBackend — AES-256-GCM envelope around any StorageBackend.
 *
 * # Two wire formats
 *
 * ## v1 — direct (legacy, still supported on FETCH):
 *   [ magic("DPO2U\x01") | nonce(12) | tag(16) | ciphertext ]
 *   Single key encrypts content directly. Key rotation requires re-uploading
 *   every file.
 *
 * ## v2 — envelope (default for NEW uploads since 2026-04-22):
 *   [ magic("DPO2U\x02")      ] (6 bytes)
 *   [ wrap_nonce(12)          ] (AES-GCM nonce for KEK→DEK wrap)
 *   [ wrap_tag(16)            ] (auth tag for wrap step)
 *   [ wrapped_dek(32)         ] (ciphertext of the random DEK)
 *   [ data_nonce(12)          ] (AES-GCM nonce for DEK→plaintext)
 *   [ data_tag(16)            ] (auth tag for data step)
 *   [ ciphertext              ] (AES-GCM over plaintext with DEK)
 *
 * A fresh 256-bit DEK (Data Encryption Key) is generated per file and used
 * to encrypt the payload. The DEK is then wrapped (encrypted) with the
 * caller-provided KEK (Key Encryption Key). Only the KEK needs to be
 * rotated / backed up / stored in KMS. DEK rotation happens for free on
 * each upload.
 *
 * # Auto-detect on FETCH
 *
 * `fetch(uri)` inspects the magic prefix:
 *   - `DPO2U\x01` → v1 direct path, treating the user key as a DEK.
 *   - `DPO2U\x02` → v2 envelope path, treating the user key as a KEK.
 *
 * This means v1 blobs uploaded with an older client can still be read by a
 * v2 client, as long as the same 32-byte key is used. No migration needed.
 *
 * # Key management (callers' responsibility)
 *
 * This class does NOT manage KEK lifecycle. Plug in one of:
 *   - `KekVault` (from './kek-vault.js') — scrypt-wrapped KEK at ~/.dpo2u/kek.enc
 *   - AWS KMS / HashiCorp Vault / Solana Keystone (bring your own)
 *   - Plaintext key in memory (fine for tests, bad for production)
 *
 * # Compared to FHE
 *
 * AES-GCM is for confidentiality at rest — hide the content. FHE is for
 * computation on ciphertext — compute without decrypting. They're
 * orthogonal primitives; use AES-GCM here, use the dpo2u-mcp FHE tools
 * (TenSEAL/CKKS) for encrypted analytics.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { StorageBackend, PayloadNotFoundError } from './types.js';

const NONCE_LEN = 12; // GCM standard
const TAG_LEN = 16;
const KEY_LEN = 32; // AES-256

const MAGIC_V1 = Buffer.from('DPO2U\x01', 'utf-8'); // 6 bytes
const MAGIC_V2 = Buffer.from('DPO2U\x02', 'utf-8'); // 6 bytes

export type EncryptionMode = 'direct' | 'envelope';

export class EncryptedBackendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EncryptedBackendError';
  }
}

export interface EncryptedStorageBackendOptions {
  /**
   * Upload wire format. Default: `'envelope'` (v2, random DEK per file).
   * Use `'direct'` (v1) only for back-compat with legacy deployments.
   * Fetch auto-detects — you can switch modes freely without re-uploading.
   */
  mode?: EncryptionMode;
}

export class EncryptedStorageBackend implements StorageBackend {
  readonly kind: 'mock' | 'ipfs' | 'shdw';
  private readonly mode: EncryptionMode;

  constructor(
    private readonly inner: StorageBackend,
    /** 32-byte key — treated as DEK in 'direct' mode, as KEK in 'envelope' mode. */
    private readonly key: Uint8Array,
    opts: EncryptedStorageBackendOptions = {},
  ) {
    if (key.length !== KEY_LEN) {
      throw new EncryptedBackendError(
        `EncryptedStorageBackend requires a ${KEY_LEN}-byte key (got ${key.length})`,
      );
    }
    this.kind = inner.kind;
    this.mode = opts.mode ?? 'envelope';
  }

  // ─── UPLOAD ─────────────────────────────────────────────────────────────

  async upload(content: Uint8Array, name: string): Promise<string> {
    const blob = this.mode === 'envelope'
      ? this.encryptV2(content)
      : this.encryptV1(content);
    return this.inner.upload(new Uint8Array(blob), name);
  }

  private encryptV1(content: Uint8Array): Buffer {
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.key), nonce);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(content)),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC_V1, nonce, tag, ciphertext]);
  }

  private encryptV2(content: Uint8Array): Buffer {
    // Fresh DEK per file
    const dek = randomBytes(KEY_LEN);

    // Wrap DEK with caller's KEK
    const wrapNonce = randomBytes(NONCE_LEN);
    const wrapCipher = createCipheriv('aes-256-gcm', Buffer.from(this.key), wrapNonce);
    const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapTag = wrapCipher.getAuthTag();
    if (wrappedDek.length !== KEY_LEN) {
      // Paranoia — AES-GCM produces ciphertext the same length as plaintext;
      // a 32-byte DEK always wraps to 32 bytes. This check catches env bugs.
      throw new EncryptedBackendError(
        `internal: wrapped_dek length ${wrappedDek.length} != ${KEY_LEN}`,
      );
    }

    // Encrypt payload with DEK
    const dataNonce = randomBytes(NONCE_LEN);
    const dataCipher = createCipheriv('aes-256-gcm', dek, dataNonce);
    const ciphertext = Buffer.concat([
      dataCipher.update(Buffer.from(content)),
      dataCipher.final(),
    ]);
    const dataTag = dataCipher.getAuthTag();

    return Buffer.concat([
      MAGIC_V2,
      wrapNonce,
      wrapTag,
      wrappedDek,
      dataNonce,
      dataTag,
      ciphertext,
    ]);
  }

  // ─── FETCH (auto-detect) ────────────────────────────────────────────────

  async fetch(uri: string): Promise<Uint8Array> {
    let blob: Uint8Array;
    try {
      blob = await this.inner.fetch(uri);
    } catch (err) {
      if (err instanceof PayloadNotFoundError) throw err;
      throw new EncryptedBackendError(
        `inner fetch failed for ${uri}: ${(err as Error).message}`,
      );
    }

    if (blob.length < 6) {
      throw new EncryptedBackendError('blob too short — not a DPO2U encrypted payload');
    }
    const magicSlice = Buffer.from(blob.slice(0, 6));
    if (timingSafeEqual(magicSlice, MAGIC_V2)) {
      return this.decryptV2(blob);
    }
    if (timingSafeEqual(magicSlice, MAGIC_V1)) {
      return this.decryptV1(blob);
    }
    throw new EncryptedBackendError(
      'payload is not a DPO2U encrypted envelope (unknown magic). ' +
        'Either it was uploaded in cleartext or with an incompatible client.',
    );
  }

  private decryptV1(blob: Uint8Array): Uint8Array {
    const minLen = 6 + NONCE_LEN + TAG_LEN;
    if (blob.length < minLen) {
      throw new EncryptedBackendError('v1 blob too short — truncated or corrupted');
    }
    const nonce = Buffer.from(blob.slice(6, 6 + NONCE_LEN));
    const tag = Buffer.from(blob.slice(6 + NONCE_LEN, 6 + NONCE_LEN + TAG_LEN));
    const ct = Buffer.from(blob.slice(6 + NONCE_LEN + TAG_LEN));

    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.key), nonce);
    decipher.setAuthTag(tag);
    try {
      return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
    } catch (err) {
      throw new EncryptedBackendError(
        `AES-GCM v1 auth tag mismatch — key incorrect or ciphertext tampered (${(err as Error).message})`,
      );
    }
  }

  private decryptV2(blob: Uint8Array): Uint8Array {
    // Layout: magic(6) | wrap_nonce(12) | wrap_tag(16) | wrapped_dek(32) | data_nonce(12) | data_tag(16) | ciphertext
    const minLen = 6 + NONCE_LEN + TAG_LEN + KEY_LEN + NONCE_LEN + TAG_LEN;
    if (blob.length < minLen) {
      throw new EncryptedBackendError('v2 blob too short — truncated or corrupted');
    }
    let off = 6;
    const wrapNonce = Buffer.from(blob.slice(off, off + NONCE_LEN)); off += NONCE_LEN;
    const wrapTag = Buffer.from(blob.slice(off, off + TAG_LEN)); off += TAG_LEN;
    const wrappedDek = Buffer.from(blob.slice(off, off + KEY_LEN)); off += KEY_LEN;
    const dataNonce = Buffer.from(blob.slice(off, off + NONCE_LEN)); off += NONCE_LEN;
    const dataTag = Buffer.from(blob.slice(off, off + TAG_LEN)); off += TAG_LEN;
    const ciphertext = Buffer.from(blob.slice(off));

    // Unwrap DEK with KEK
    const unwrapCipher = createDecipheriv('aes-256-gcm', Buffer.from(this.key), wrapNonce);
    unwrapCipher.setAuthTag(wrapTag);
    let dek: Buffer;
    try {
      dek = Buffer.concat([unwrapCipher.update(wrappedDek), unwrapCipher.final()]);
    } catch (err) {
      throw new EncryptedBackendError(
        `AES-GCM v2 KEK unwrap failed — KEK incorrect or wrapped_dek tampered (${(err as Error).message})`,
      );
    }
    if (dek.length !== KEY_LEN) {
      throw new EncryptedBackendError(`unwrapped DEK length ${dek.length} != ${KEY_LEN}`);
    }

    // Decrypt payload with DEK
    const dataDecipher = createDecipheriv('aes-256-gcm', dek, dataNonce);
    dataDecipher.setAuthTag(dataTag);
    try {
      return new Uint8Array(
        Buffer.concat([dataDecipher.update(ciphertext), dataDecipher.final()]),
      );
    } catch (err) {
      throw new EncryptedBackendError(
        `AES-GCM v2 data auth tag mismatch — ciphertext tampered after KEK unwrap (${(err as Error).message})`,
      );
    }
  }

  async delete(uri: string): Promise<void> {
    return this.inner.delete(uri);
  }
}

/**
 * Helper for callers that pass keys as hex strings (CLI, env vars, KMS getters).
 */
export function keyFromHex(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new EncryptedBackendError('encrypt-key must be a hex string');
  }
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== KEY_LEN) {
    throw new EncryptedBackendError(
      `encrypt-key must decode to ${KEY_LEN} bytes (got ${buf.length} from "${cleaned.slice(0, 16)}...")`,
    );
  }
  return new Uint8Array(buf);
}

/**
 * Convenience factory: wrap any StorageBackend with AES-GCM envelope encryption.
 * Default mode is `'envelope'` (v2). Pass `{ mode: 'direct' }` for v1.
 */
export function withEncryption(
  inner: StorageBackend,
  key: Uint8Array,
  opts: EncryptedStorageBackendOptions = {},
): EncryptedStorageBackend {
  return new EncryptedStorageBackend(inner, key, opts);
}
