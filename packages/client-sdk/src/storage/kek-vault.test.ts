/**
 * KekVault — scrypt-wrapped local KEK vault tests.
 * Uses a custom path in /tmp to avoid touching ~/.dpo2u during test runs.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KekVault, KekVaultError } from './kek-vault.js';
import { EncryptedStorageBackend } from './encrypted.js';
import { MockBackend } from './mock.js';

let tmpDir: string;
let vaultPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kek-vault-test-'));
  vaultPath = join(tmpDir, 'kek.enc');
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('KekVault — create + load roundtrip', () => {
  it('create generates a fresh KEK, load retrieves the same bytes', async () => {
    const created = await KekVault.create({ path: vaultPath, passphrase: 'correct-horse-battery-staple' });
    expect(existsSync(vaultPath)).toBe(true);
    const kek1 = created.getKek();
    expect(kek1.length).toBe(32);

    const loaded = await KekVault.load({ path: vaultPath, passphrase: 'correct-horse-battery-staple' });
    const kek2 = loaded.getKek();
    expect(Buffer.from(kek1).equals(Buffer.from(kek2))).toBe(true);
  });

  it('create refuses to overwrite existing vault', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'p1' });
    await expect(KekVault.create({ path: vaultPath, passphrase: 'p2' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('load with wrong passphrase fails with KekVaultError', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'right-one' });
    await expect(
      KekVault.load({ path: vaultPath, passphrase: 'wrong-one' }),
    ).rejects.toThrow(KekVaultError);
  });

  it('load with wrong passphrase mentions "wrong passphrase"', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'right-one' });
    await expect(
      KekVault.load({ path: vaultPath, passphrase: 'wrong' }),
    ).rejects.toThrow(/wrong passphrase|corrupted/);
  });

  it('load with non-existent path fails', async () => {
    await expect(
      KekVault.load({ path: join(tmpDir, 'nope.enc'), passphrase: 'x' }),
    ).rejects.toThrow(/not found/);
  });

  it('createOrLoad creates when missing, loads when present', async () => {
    // First call creates
    const a = await KekVault.createOrLoad({ path: vaultPath, passphrase: 'pw' });
    // Second call loads
    const b = await KekVault.createOrLoad({ path: vaultPath, passphrase: 'pw' });
    expect(Buffer.from(a.getKek()).equals(Buffer.from(b.getKek()))).toBe(true);
  });
});

describe('KekVault — file format', () => {
  it('vault file starts with DPO2UKEK\\x01 magic', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'pw' });
    const blob = readFileSync(vaultPath);
    expect(blob.slice(0, 8).toString('utf-8')).toBe('DPO2UKEK');
    expect(blob[8]).toBe(0x01); // version byte
  });

  it('KEK is 32 bytes', async () => {
    const v = await KekVault.create({ path: vaultPath, passphrase: 'pw' });
    expect(v.getKek().length).toBe(32);
  });

  it('same passphrase on fresh vault produces DIFFERENT KEK (random)', async () => {
    const v1 = await KekVault.create({ path: vaultPath, passphrase: 'same' });
    rmSync(vaultPath);
    const v2 = await KekVault.create({ path: vaultPath, passphrase: 'same' });
    expect(Buffer.from(v1.getKek()).equals(Buffer.from(v2.getKek()))).toBe(false);
  });
});

describe('KekVault — changePassphrase (KEK preserved)', () => {
  it('new passphrase loads the SAME KEK', async () => {
    const original = await KekVault.create({ path: vaultPath, passphrase: 'old' });
    const originalKek = original.getKek();

    await KekVault.changePassphrase({ path: vaultPath, oldPassphrase: 'old', newPassphrase: 'new' });

    const reloaded = await KekVault.load({ path: vaultPath, passphrase: 'new' });
    expect(Buffer.from(reloaded.getKek()).equals(Buffer.from(originalKek))).toBe(true);
  });

  it('old passphrase no longer works after change', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'old' });
    await KekVault.changePassphrase({ path: vaultPath, oldPassphrase: 'old', newPassphrase: 'new' });

    await expect(
      KekVault.load({ path: vaultPath, passphrase: 'old' }),
    ).rejects.toThrow(/wrong passphrase|corrupted/);
  });

  it('changePassphrase fails if old passphrase is wrong', async () => {
    await KekVault.create({ path: vaultPath, passphrase: 'correct' });
    await expect(
      KekVault.changePassphrase({
        path: vaultPath,
        oldPassphrase: 'wrong',
        newPassphrase: 'new',
      }),
    ).rejects.toThrow(/wrong passphrase|corrupted/);
  });
});

describe('KekVault → EncryptedStorageBackend integration', () => {
  it('end-to-end: KEK from vault → encrypt → decrypt', async () => {
    const vault = await KekVault.create({ path: vaultPath, passphrase: 'pw' });
    const kek = vault.getKek();

    const inner = new MockBackend();
    const backend = new EncryptedStorageBackend(inner, kek); // default v2 envelope

    const payload = new TextEncoder().encode('LGPD termo de consentimento — user X');
    const uri = await backend.upload(payload, 'termo.txt');
    const decrypted = await backend.fetch(uri);

    expect(Buffer.from(decrypted).equals(Buffer.from(payload))).toBe(true);

    // Inner sees only ciphertext
    const raw = await inner.fetch(uri);
    const rawStr = Buffer.from(raw).toString('utf-8');
    expect(rawStr.includes('LGPD')).toBe(false);
    expect(rawStr.includes('consentimento')).toBe(false);
  });

  it('after passphrase rotation, the same ciphertext is still decryptable', async () => {
    const vault1 = await KekVault.create({ path: vaultPath, passphrase: 'old' });
    const inner = new MockBackend();
    const backend1 = new EncryptedStorageBackend(inner, vault1.getKek());

    const payload = new TextEncoder().encode('data-before-rotation');
    const uri = await backend1.upload(payload, 'x');

    // Rotate passphrase (same KEK, different wrapping)
    await KekVault.changePassphrase({ path: vaultPath, oldPassphrase: 'old', newPassphrase: 'new' });

    // Reload with new passphrase
    const vault2 = await KekVault.load({ path: vaultPath, passphrase: 'new' });
    const backend2 = new EncryptedStorageBackend(inner, vault2.getKek());

    // Same KEK — ciphertext still decryptable
    const out = await backend2.fetch(uri);
    expect(Buffer.from(out).equals(Buffer.from(payload))).toBe(true);
  });
});
