/**
 * KekVault — passphrase-protected Key Encryption Key at ~/.dpo2u/kek.enc.
 *
 * The KEK itself is a 32-byte random value used by `EncryptedStorageBackend`
 * (envelope mode) to wrap per-file DEKs. We encrypt the KEK with a
 * scrypt-derived key from a human passphrase so it can live on disk safely.
 *
 * File format (~/.dpo2u/kek.enc):
 *   [ magic("DPO2UKEK\x01") ] (10 bytes)
 *   [ scrypt_salt(16)       ] (unique per KEK, included for derivation)
 *   [ N(4), r(4), p(4)      ] (scrypt parameters — big-endian u32)
 *   [ data_nonce(12)        ] (AES-GCM nonce for KEK encryption)
 *   [ data_tag(16)          ] (auth tag)
 *   [ encrypted_kek(32)     ] (32-byte KEK encrypted with scrypt-derived key)
 *
 * Interactive use:
 *   const vault = await KekVault.createOrLoad({ passphrase });
 *   const kek = vault.getKek(); // 32 bytes, use with EncryptedStorageBackend
 *
 * Rotation (re-wrap same KEK with new passphrase):
 *   await KekVault.changePassphrase({ old, new });
 *
 * WARNING: this class does NOT rotate the underlying KEK itself — changing
 * the passphrase re-encrypts the SAME KEK. Rotating the KEK requires
 * re-uploading every file (each file's wrapped_dek was made against the old
 * KEK) and is left to a higher-level tool.
 *
 * Production alternatives:
 *   - AWS KMS: never export the KEK, use GenerateDataKey API server-side
 *   - HashiCorp Vault Transit: same pattern
 *   - Hardware keystores (Secure Enclave, TPM): platform-specific
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAGIC = Buffer.from('DPO2UKEK\x01\x00', 'utf-8'); // 10 bytes — 'DPO2UKEK' + version byte + null
const KEK_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

// scrypt parameters — 2^17 N, 8 r, 1 p ≈ 128 MB memory, ~1 s CPU.
// Strong enough for a human passphrase; tune down if running on tiny containers.
const SCRYPT_N = 1 << 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const DEFAULT_VAULT_PATH = join(homedir(), '.dpo2u', 'kek.enc');

export class KekVaultError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'KekVaultError';
  }
}

export interface KekVaultOptions {
  /** Path to the vault file. Default: ~/.dpo2u/kek.enc */
  path?: string;
  /** Passphrase used to derive the wrapping key via scrypt. */
  passphrase: string;
}

export class KekVault {
  private constructor(private readonly kek: Uint8Array, private readonly path: string) {}

  /** Returns a COPY of the KEK. Never share the original reference. */
  getKek(): Uint8Array {
    return new Uint8Array(this.kek);
  }

  getPath(): string {
    return this.path;
  }

  /**
   * Create a fresh vault if `path` doesn't exist; otherwise load and decrypt.
   * Convenient entry point for CLI/app startup.
   */
  static async createOrLoad(opts: KekVaultOptions): Promise<KekVault> {
    const path = opts.path ?? DEFAULT_VAULT_PATH;
    if (existsSync(path)) {
      return KekVault.load(opts);
    }
    return KekVault.create(opts);
  }

  /** Generate a fresh KEK, write to disk. Fails if the file already exists. */
  static async create(opts: KekVaultOptions): Promise<KekVault> {
    const path = opts.path ?? DEFAULT_VAULT_PATH;
    if (existsSync(path)) {
      throw new KekVaultError(
        `vault file already exists at ${path} — refuse to overwrite. Use load() or delete the file first.`,
      );
    }

    const kek = randomBytes(KEK_LEN);
    const salt = randomBytes(SALT_LEN);
    const wrap = scryptSync(opts.passphrase, salt, KEK_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_N * SCRYPT_R * 256, // ~256 MB headroom for N=2^17
    });
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv('aes-256-gcm', wrap, nonce);
    const enc = Buffer.concat([cipher.update(kek), cipher.final()]);
    const tag = cipher.getAuthTag();

    const paramsBuf = Buffer.alloc(12);
    paramsBuf.writeUInt32BE(SCRYPT_N, 0);
    paramsBuf.writeUInt32BE(SCRYPT_R, 4);
    paramsBuf.writeUInt32BE(SCRYPT_P, 8);

    const blob = Buffer.concat([MAGIC, salt, paramsBuf, nonce, tag, enc]);

    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, blob, { mode: 0o600 });

    return new KekVault(new Uint8Array(kek), path);
  }

  /** Load an existing vault and decrypt the KEK. */
  static async load(opts: KekVaultOptions): Promise<KekVault> {
    const path = opts.path ?? DEFAULT_VAULT_PATH;
    if (!existsSync(path)) {
      throw new KekVaultError(`vault file not found at ${path}. Use create() or createOrLoad().`);
    }

    const blob = readFileSync(path);
    let off = 0;
    if (blob.length < MAGIC.length) {
      throw new KekVaultError('vault file too short — not a DPO2U KEK vault');
    }
    const magic = blob.slice(off, off + MAGIC.length);
    if (!timingSafeEqual(magic, MAGIC)) {
      throw new KekVaultError(
        `vault file at ${path} has invalid magic — not a DPO2U KEK vault or wrong version`,
      );
    }
    off += MAGIC.length;

    const salt = blob.slice(off, off + SALT_LEN); off += SALT_LEN;
    const N = blob.readUInt32BE(off); off += 4;
    const r = blob.readUInt32BE(off); off += 4;
    const p = blob.readUInt32BE(off); off += 4;
    const nonce = blob.slice(off, off + NONCE_LEN); off += NONCE_LEN;
    const tag = blob.slice(off, off + TAG_LEN); off += TAG_LEN;
    const enc = blob.slice(off);

    const wrap = scryptSync(opts.passphrase, salt, KEK_LEN, {
      N,
      r,
      p,
      maxmem: N * r * 256,
    });
    const decipher = createDecipheriv('aes-256-gcm', wrap, nonce);
    decipher.setAuthTag(tag);
    let kek: Buffer;
    try {
      kek = Buffer.concat([decipher.update(enc), decipher.final()]);
    } catch (err) {
      throw new KekVaultError(
        `KEK unwrap failed — wrong passphrase or vault file corrupted (${(err as Error).message})`,
      );
    }
    if (kek.length !== KEK_LEN) {
      throw new KekVaultError(`decrypted KEK length ${kek.length} != ${KEK_LEN}`);
    }

    return new KekVault(new Uint8Array(kek), path);
  }

  /**
   * Change the passphrase WITHOUT rotating the KEK itself — re-encrypts the
   * same 32-byte KEK under a new scrypt-derived wrapping key. Safe: all
   * previously-wrapped DEKs still unwrap because the KEK didn't change.
   */
  static async changePassphrase(opts: {
    path?: string;
    oldPassphrase: string;
    newPassphrase: string;
  }): Promise<void> {
    const existing = await KekVault.load({
      path: opts.path,
      passphrase: opts.oldPassphrase,
    });
    const kek = existing.getKek();
    const path = existing.getPath();

    // Overwrite by deleting first (create() refuses to overwrite)
    const salt = randomBytes(SALT_LEN);
    const wrap = scryptSync(opts.newPassphrase, salt, KEK_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_N * SCRYPT_R * 256,
    });
    const nonce = randomBytes(NONCE_LEN);
    const cipher = createCipheriv('aes-256-gcm', wrap, nonce);
    const enc = Buffer.concat([cipher.update(kek), cipher.final()]);
    const tag = cipher.getAuthTag();

    const paramsBuf = Buffer.alloc(12);
    paramsBuf.writeUInt32BE(SCRYPT_N, 0);
    paramsBuf.writeUInt32BE(SCRYPT_R, 4);
    paramsBuf.writeUInt32BE(SCRYPT_P, 8);

    const blob = Buffer.concat([MAGIC, salt, paramsBuf, nonce, tag, enc]);
    writeFileSync(path, blob, { mode: 0o600 });
  }
}

export function defaultKekVaultPath(): string {
  return DEFAULT_VAULT_PATH;
}
