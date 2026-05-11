/**
 * AES-GCM — v1 direct + v2 envelope roundtrip / tamper detection / key management.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

import { MockBackend } from './mock.js';
import {
  EncryptedStorageBackend,
  EncryptedBackendError,
  keyFromHex,
  withEncryption,
} from './encrypted.js';
import { PayloadNotFoundError } from './types.js';

function freshKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

function v1(inner: MockBackend, key: Uint8Array) {
  return new EncryptedStorageBackend(inner, key, { mode: 'direct' });
}

function v2(inner: MockBackend, key: Uint8Array) {
  return new EncryptedStorageBackend(inner, key, { mode: 'envelope' });
}

describe('EncryptedStorageBackend — construction', () => {
  it('preserves inner.kind', () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());
    expect(enc.kind).toBe('mock');
  });

  it('rejects wrong-length keys', () => {
    const inner = new MockBackend();
    expect(() => new EncryptedStorageBackend(inner, new Uint8Array(16))).toThrow(
      /requires a 32-byte key/,
    );
    expect(() => new EncryptedStorageBackend(inner, new Uint8Array(64))).toThrow(
      /requires a 32-byte key/,
    );
  });
});

describe('EncryptedStorageBackend — roundtrip', () => {
  it('upload → fetch returns original bytes', async () => {
    const inner = new MockBackend();
    const key = freshKey();
    const enc = new EncryptedStorageBackend(inner, key);

    const payload = new TextEncoder().encode('LGPD termo de consentimento — Fred Santana, 22/04/2026');
    const uri = await enc.upload(payload, 'termo.txt');
    const fetched = await enc.fetch(uri);

    expect(Buffer.from(fetched).equals(Buffer.from(payload))).toBe(true);
  });

  it('inner backend sees only ciphertext (not plaintext)', async () => {
    const inner = new MockBackend();
    const key = freshKey();
    const enc = new EncryptedStorageBackend(inner, key);

    const plaintext = new TextEncoder().encode('CPF 123.456.789-00');
    const uri = await enc.upload(plaintext, 'pii.txt');

    // Fetch via inner directly — should NOT contain "123.456.789"
    const rawBlob = await inner.fetch(uri);
    const asString = Buffer.from(rawBlob).toString('utf-8');
    expect(asString).not.toContain('123.456.789');
    expect(asString).not.toContain('CPF');
  });

  it('empty payload roundtrips', async () => {
    const enc = new EncryptedStorageBackend(new MockBackend(), freshKey());
    const uri = await enc.upload(new Uint8Array(0), 'empty');
    const out = await enc.fetch(uri);
    expect(out.length).toBe(0);
  });

  it('large payload (1 MB) roundtrips', async () => {
    const enc = new EncryptedStorageBackend(new MockBackend(), freshKey());
    const payload = new Uint8Array(randomBytes(1024 * 1024));
    const uri = await enc.upload(payload, 'big.bin');
    const out = await enc.fetch(uri);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });

  it('each upload uses a fresh nonce — 2 uploads of same content have different blobs', async () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());
    const payload = new TextEncoder().encode('same content');

    const uri1 = await enc.upload(payload, 'a');
    const uri2 = await enc.upload(payload, 'b');
    expect(uri1).not.toBe(uri2);

    const blob1 = await inner.fetch(uri1);
    const blob2 = await inner.fetch(uri2);
    expect(Buffer.from(blob1).equals(Buffer.from(blob2))).toBe(false);
  });
});

describe('EncryptedStorageBackend — tamper detection', () => {
  it('wrong key fails (v2 KEK unwrap OR v1 tag mismatch)', async () => {
    const inner = new MockBackend();
    const encA = new EncryptedStorageBackend(inner, freshKey());
    const encB = new EncryptedStorageBackend(inner, freshKey()); // different key, same inner

    const uri = await encA.upload(new TextEncoder().encode('secret'), 'x');
    // v2 default → "KEK unwrap failed"; v1 → "auth tag mismatch"
    await expect(encB.fetch(uri)).rejects.toThrow(/KEK unwrap failed|auth tag mismatch/);
  });

  it('tampering with the ciphertext is detected', async () => {
    // Mock backend exposes internal map; we poke at it to tamper.
    const inner = new MockBackend();
    const key = freshKey();
    const enc = new EncryptedStorageBackend(inner, key);

    const uri = await enc.upload(new TextEncoder().encode('original'), 'x');
    const blob = Buffer.from(await inner.fetch(uri));
    // Flip a byte near the end (inside ciphertext, not auth tag or nonce)
    blob[blob.length - 1] ^= 0x01;
    // Re-upload the tampered blob under a fresh mock entry
    await inner.delete(uri);
    const tamperedUri = await inner.upload(new Uint8Array(blob), 'x-tampered');

    await expect(enc.fetch(tamperedUri)).rejects.toThrow(/auth tag mismatch/);
  });

  it('fetching a cleartext blob (no magic prefix) fails with clear error', async () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());

    // Upload bypassing encryption
    const cleartextUri = await inner.upload(
      new TextEncoder().encode('I was never encrypted'),
      'leak.txt',
    );

    await expect(enc.fetch(cleartextUri)).rejects.toThrow(/not a DPO2U encrypted envelope/);
  });

  it('truncated blob is rejected', async () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());

    const uri = await enc.upload(new TextEncoder().encode('x'), 'x');
    const full = Buffer.from(await inner.fetch(uri));
    const truncated = full.slice(0, 10); // too short even for magic+nonce+tag
    await inner.delete(uri);
    const uri2 = await inner.upload(new Uint8Array(truncated), 'x-trunc');

    await expect(enc.fetch(uri2)).rejects.toThrow(/too short/);
  });
});

describe('EncryptedStorageBackend — delete delegates to inner', () => {
  it('delete removes the inner blob too', async () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('x'), 'x');
    await enc.delete(uri);

    await expect(inner.fetch(uri)).rejects.toThrow(PayloadNotFoundError);
  });
});

describe('keyFromHex', () => {
  it('accepts 64-char hex (with or without 0x prefix)', () => {
    const hex = 'a'.repeat(64);
    expect(keyFromHex(hex).length).toBe(32);
    expect(keyFromHex('0x' + hex).length).toBe(32);
    expect(keyFromHex('0X' + hex).length).toBe(32);
  });

  it('rejects non-hex characters', () => {
    expect(() => keyFromHex('z'.repeat(64))).toThrow(/hex string/);
  });

  it('rejects wrong length', () => {
    expect(() => keyFromHex('ab')).toThrow(/32 bytes/);
    expect(() => keyFromHex('a'.repeat(128))).toThrow(/32 bytes/);
  });
});

describe('withEncryption factory', () => {
  it('returns an EncryptedStorageBackend', () => {
    const wrapped = withEncryption(new MockBackend(), freshKey());
    expect(wrapped).toBeInstanceOf(EncryptedStorageBackend);
  });

  it('composable: encrypted roundtrip via factory', async () => {
    const enc = withEncryption(new MockBackend(), freshKey());
    const payload = new TextEncoder().encode('factory-path');
    const uri = await enc.upload(payload, 'x');
    const out = await enc.fetch(uri);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });
});

describe('EncryptedBackendError', () => {
  it('is a distinguishable error class', () => {
    try {
      new EncryptedStorageBackend(new MockBackend(), new Uint8Array(10));
    } catch (e) {
      expect(e).toBeInstanceOf(EncryptedBackendError);
      expect((e as Error).name).toBe('EncryptedBackendError');
    }
  });
});

describe('v2 envelope encryption (DEK/KEK)', () => {
  it('v2 wire format has magic DPO2U\\x02', async () => {
    const inner = new MockBackend();
    const enc = v2(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('hi'), 'x');
    const blob = await inner.fetch(uri);
    // magic(6) = "DPO2U" + 0x02
    expect(blob[0]).toBe(0x44); // D
    expect(blob[1]).toBe(0x50); // P
    expect(blob[5]).toBe(0x02); // v2
  });

  it('v1 wire format has magic DPO2U\\x01', async () => {
    const inner = new MockBackend();
    const enc = v1(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('hi'), 'x');
    const blob = await inner.fetch(uri);
    expect(blob[5]).toBe(0x01); // v1
  });

  it('v2 envelope roundtrip', async () => {
    const inner = new MockBackend();
    const enc = v2(inner, freshKey());
    const payload = new TextEncoder().encode('envelope-payload');
    const uri = await enc.upload(payload, 'x');
    const out = await enc.fetch(uri);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });

  it('v2: each upload uses a fresh DEK (so 2 uploads of same content have different wrapped_dek)', async () => {
    const inner = new MockBackend();
    const enc = v2(inner, freshKey());
    const payload = new TextEncoder().encode('same');

    const uri1 = await enc.upload(payload, 'a');
    const uri2 = await enc.upload(payload, 'b');
    const blob1 = Buffer.from(await inner.fetch(uri1));
    const blob2 = Buffer.from(await inner.fetch(uri2));

    // Extract wrapped_dek bytes: magic(6) + wrap_nonce(12) + wrap_tag(16) = 34, then 32 bytes wrapped_dek
    const dek1 = blob1.slice(34, 34 + 32);
    const dek2 = blob2.slice(34, 34 + 32);
    expect(dek1.equals(dek2)).toBe(false); // DEKs are random and different
  });

  it('v2: v1-uploaded blob is still readable with same key (auto-detect on fetch)', async () => {
    const inner = new MockBackend();
    const key = freshKey();
    // Upload with v1
    const encV1 = v1(inner, key);
    const payload = new TextEncoder().encode('legacy-v1-content');
    const uri = await encV1.upload(payload, 'legacy');

    // Fetch with v2-mode client — should auto-detect v1 magic and decrypt
    const encV2 = v2(inner, key);
    const out = await encV2.fetch(uri);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });

  it('default mode is envelope (v2)', async () => {
    const inner = new MockBackend();
    const enc = new EncryptedStorageBackend(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('default'), 'x');
    const blob = await inner.fetch(uri);
    expect(blob[5]).toBe(0x02); // default = v2
  });

  it('v2 wrong KEK fails unwrap step (not data step)', async () => {
    const inner = new MockBackend();
    const encA = v2(inner, freshKey());
    const encB = v2(inner, freshKey());

    const uri = await encA.upload(new TextEncoder().encode('secret'), 'x');
    await expect(encB.fetch(uri)).rejects.toThrow(/KEK unwrap failed/);
  });

  it('v2 tampering with wrapped_dek is detected at unwrap step', async () => {
    const inner = new MockBackend();
    const enc = v2(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('pii'), 'x');
    const blob = Buffer.from(await inner.fetch(uri));
    // Flip a byte in wrapped_dek (offset 34, 32 bytes long)
    blob[40] ^= 0x01;
    await inner.delete(uri);
    const tampUri = await inner.upload(new Uint8Array(blob), 'tamp');
    await expect(enc.fetch(tampUri)).rejects.toThrow(/KEK unwrap failed/);
  });

  it('v2 tampering with ciphertext is detected at data step', async () => {
    const inner = new MockBackend();
    const enc = v2(inner, freshKey());
    const uri = await enc.upload(new TextEncoder().encode('pii-data'), 'x');
    const blob = Buffer.from(await inner.fetch(uri));
    // Flip last byte (inside ciphertext, not tags)
    blob[blob.length - 1] ^= 0x01;
    await inner.delete(uri);
    const tampUri = await inner.upload(new Uint8Array(blob), 'tamp');
    await expect(enc.fetch(tampUri)).rejects.toThrow(/data auth tag mismatch/);
  });
});
