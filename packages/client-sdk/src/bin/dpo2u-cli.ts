#!/usr/bin/env node
/**
 * dpo2u-cli — drive DPO2UClient from the command line.
 *
 * Subcommands:
 *   attest      submit a verified attestation using a committed proof
 *   fetch       fetch a subject's attestation PDA and pretty-print
 *   erase       LGPD Art. 18: delete off-chain payload + revoke on-chain attestation
 */

import { Command } from 'commander';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DPO2UClient, type ClusterName } from '../client.js';
import { DPO2UConsentClient } from '../consent.js';
import {
  createStorageBackend,
  type BackendKind,
  EncryptedStorageBackend,
  keyFromHex,
} from '../storage/index.js';
import type { StorageBackend } from '../storage/types.js';
import { login as oauthLogin, loadSavedToken, defaultTokenPath } from '../oauth.js';
import { unlinkSync, existsSync } from 'node:fs';

const program = new Command();
program
  .name('dpo2u-cli')
  .description('DPO2U compliance attestation client — Solana SP1 v6')
  .version('0.1.0');

function loadKeypair(p: string): Keypair {
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
  const bytes = JSON.parse(readFileSync(expanded, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function buildBackend(opts: {
  backend: string;
  cluster: string;
  url?: string;
  signer: Keypair;
  shdwStorageAccount?: string;
  /** Optional hex-encoded 32-byte AES-256-GCM key. If set, the returned
   *  backend encrypts on upload and decrypts on fetch automatically. */
  encryptKey?: string;
}): Promise<StorageBackend> {
  const kind = opts.backend as BackendKind;
  let inner: StorageBackend;
  if (kind === 'shdw') {
    if (!opts.shdwStorageAccount) {
      throw new Error('backend=shdw requires --shdw-storage-account <pubkey>');
    }
    if (opts.cluster !== 'mainnet-beta') {
      throw new Error('backend=shdw requires --cluster mainnet-beta (Shadow Drive does not support devnet)');
    }
    const connection = new Connection(
      opts.url ?? 'https://api.mainnet-beta.solana.com',
      'confirmed',
    );
    inner = await createStorageBackend('shdw', {
      connection,
      wallet: opts.signer,
      storageAccount: new PublicKey(opts.shdwStorageAccount),
      cluster: opts.cluster,
    });
  } else {
    inner = await createStorageBackend(kind);
  }
  if (opts.encryptKey) {
    const key = keyFromHex(opts.encryptKey);
    return new EncryptedStorageBackend(inner, key);
  }
  return inner;
}

program
  .command('attest')
  .description('Submit a create_verified_attestation transaction')
  .option('-c, --cluster <name>', 'cluster: localnet | devnet | testnet | mainnet-beta', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-k, --keypair <path>', 'path to issuer keypair JSON', '~/.config/solana/id.json')
  .option('-s, --subject <pubkey>', 'subject Solana pubkey (defaults to issuer)')
  .option('--subject-label <str>', 'label used to derive commitment (sha256(label))', 'did:test:company:acme')
  .option('-p, --proof <path>', 'path to 356-byte SP1 v6 proof', 'zk-circuits/proofs/proof.bin')
  .option('--public-values <path>', 'path to 96-byte public values', 'zk-circuits/proofs/public_values.bin')
  .option('--storage-uri <uri>', 'off-chain DPIA pointer (ignored if --upload is set)', 'ipfs://QmDPO2UDemo')
  .option('--upload <file>', 'upload file via --backend before attesting; sets storage_uri to returned URL')
  .option('--backend <kind>', 'storage backend for --upload: mock | ipfs | shdw', 'mock')
  .option('--shdw-storage-account <pubkey>', 'Shadow Drive v1 storage account (required if --backend shdw)')
  .option('--encrypt-key <hex>', 'optional hex-encoded 32-byte AES-256-GCM key; encrypts payload before upload (envelope format). Keep the key — required to fetch later.')
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const subject = opts.subject ? new PublicKey(opts.subject) : signer.publicKey;

    const proof = readFileSync(opts.proof);
    const publicValues = readFileSync(opts.publicValues);

    const client = new DPO2UClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    let storageUri = opts.storageUri;
    if (opts.upload) {
      const backend = await buildBackend({
        backend: opts.backend,
        cluster: opts.cluster,
        url: opts.url,
        signer,
        shdwStorageAccount: opts.shdwStorageAccount,
        encryptKey: opts.encryptKey,
      });
      const payload = readFileSync(opts.upload);
      const name = path.basename(opts.upload);
      storageUri = await backend.upload(new Uint8Array(payload), name);
      const encLabel = opts.encryptKey ? ' encrypted=aes-256-gcm' : '';
      console.log(`✓ payload uploaded : ${storageUri} (backend=${backend.kind}${encLabel})`);
    }

    // Commitment is always derived from the proof's public values to guarantee
    // they match. The --subject-label is just informational.
    const expectedCommitment = Buffer.from(publicValues.slice(32, 64));
    console.log(`subject      : ${subject.toBase58()}`);
    console.log(`label        : "${opts.subjectLabel}"`);
    console.log(`commitment   : 0x${expectedCommitment.toString('hex')}`);
    console.log(`cluster      : ${opts.cluster}`);
    console.log(`storage_uri  : ${storageUri}`);
    console.log('submitting tx...');

    const result = await client.attestWithProof({
      subject,
      proof: new Uint8Array(proof),
      publicInputs: new Uint8Array(publicValues),
      storageUri,
    });

    console.log();
    console.log(`✓ signature        : ${result.signature}`);
    console.log(`✓ attestation PDA  : ${result.attestationPda.toBase58()}`);
    console.log(`✓ Explorer         : ${result.explorerUrl}`);
  });

program
  .command('fetch')
  .description('Read an attestation PDA and display its contents')
  .option('-c, --cluster <name>', 'cluster', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-s, --subject <pubkey>', 'subject pubkey')
  .requiredOption('--commitment <hex>', 'commitment bytes (hex, 64 chars)')
  .option('-k, --keypair <path>', 'keypair for connection (unused but required by client)', '~/.config/solana/id.json')
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const subject = new PublicKey(opts.subject);
    const commitment = Buffer.from(opts.commitment.replace(/^0x/i, ''), 'hex');
    if (commitment.length !== 32) {
      throw new Error(`commitment must be 32 bytes hex (got ${commitment.length})`);
    }

    const client = new DPO2UClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    const rec = await client.fetchAttestation(subject, new Uint8Array(commitment));
    if (!rec) {
      console.log('no attestation found for this (subject, commitment)');
      process.exit(1);
    }
    console.log(JSON.stringify(
      {
        subject: rec.subject.toBase58(),
        issuer: rec.issuer.toBase58(),
        schemaId: rec.schemaId.toBase58(),
        commitment: `0x${Buffer.from(rec.commitment).toString('hex')}`,
        storageUri: rec.storageUri,
        issuedAt: rec.issuedAt.toString(),
        expiresAt: rec.expiresAt?.toString() ?? null,
        revokedAt: rec.revokedAt?.toString() ?? null,
        revocationReason: rec.revocationReason,
        version: rec.version,
        verified: rec.verified,
        threshold: rec.threshold,
      },
      null,
      2,
    ));
  });

program
  .command('erase')
  .description('LGPD Art. 18 — delete off-chain payload + revoke on-chain attestation')
  .option('-c, --cluster <name>', 'cluster', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-k, --keypair <path>', 'path to issuer keypair JSON', '~/.config/solana/id.json')
  .requiredOption('-s, --subject <pubkey>', 'subject pubkey whose attestation is being revoked')
  .requiredOption('--commitment <hex>', 'commitment bytes (hex, 64 chars)')
  .requiredOption('--reason <string>', 'revocation reason (<=64 chars, e.g. "LGPD_ART_18_REQUEST_2026-05-15")')
  .option('--backend <kind>', 'storage backend for payload deletion: mock | shdw | ipfs', 'mock')
  .option('--shdw-storage-account <pubkey>', 'Shadow Drive v1 storage account (required if --backend shdw)')
  .option('--skip-storage-delete', 'skip off-chain delete; only revoke on-chain', false)
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const subject = new PublicKey(opts.subject);
    const commitment = Buffer.from(opts.commitment.replace(/^0x/i, ''), 'hex');
    if (commitment.length !== 32) {
      throw new Error(`commitment must be 32 bytes hex (got ${commitment.length})`);
    }
    if (opts.reason.length > 64) {
      throw new Error(`reason must be <= 64 chars (got ${opts.reason.length})`);
    }

    const client = new DPO2UClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    const rec = await client.fetchAttestation(subject, new Uint8Array(commitment));
    if (!rec) {
      console.error('✗ no attestation found for (subject, commitment)');
      process.exit(1);
    }
    if (rec.revokedAt !== null) {
      console.error(`✗ attestation already revoked at ${rec.revokedAt} — reason: ${rec.revocationReason}`);
      process.exit(1);
    }
    if (!rec.issuer.equals(signer.publicKey)) {
      console.error(`✗ signer is not the issuer of this attestation (issuer=${rec.issuer.toBase58()})`);
      process.exit(1);
    }

    const [attestationPda] = client.deriveAttestationPda(subject, new Uint8Array(commitment));
    console.log(`subject      : ${subject.toBase58()}`);
    console.log(`attestation  : ${attestationPda.toBase58()}`);
    console.log(`storage_uri  : ${rec.storageUri}`);
    console.log(`reason       : ${opts.reason}`);
    console.log();

    // 1) Off-chain delete
    const placeholderUri = !rec.storageUri || /^ipfs:\/\/QmDPO2U/i.test(rec.storageUri);
    if (!opts.skipStorageDelete && !placeholderUri) {
      try {
        const backend = await buildBackend({
          backend: opts.backend,
          cluster: opts.cluster,
          url: opts.url,
          signer,
          shdwStorageAccount: opts.shdwStorageAccount,
        });
        await backend.delete(rec.storageUri);
        console.log(`✓ payload deleted  : ${rec.storageUri} (backend=${backend.kind})`);
      } catch (e: any) {
        // Delete failures don't block the on-chain revoke — LGPD compliance is
        // best-effort off-chain, but the on-chain seal is authoritative evidence.
        console.warn(`⚠ off-chain delete failed (proceeding anyway): ${e.message ?? e}`);
      }
    } else if (placeholderUri) {
      console.log('✓ payload skipped  : storage_uri is a demo placeholder');
    } else {
      console.log('✓ payload skipped  : --skip-storage-delete was set');
    }

    // 2) On-chain revoke
    const res = await client.revokeAttestation({
      attestation: attestationPda,
      reason: opts.reason,
    });
    console.log(`✓ on-chain revoke  : ${res.signature}`);
    console.log(`✓ Explorer         : ${res.explorerUrl}`);

    // 3) Verify
    const after = await client.fetchAttestation(subject, new Uint8Array(commitment));
    if (!after?.revokedAt) {
      console.error('✗ revoke appears to have failed — revoked_at still null');
      process.exit(1);
    }
    console.log(`✓ revoked_at       : ${new Date(Number(after.revokedAt) * 1000).toISOString()}`);
    console.log(`✓ reason on-chain  : ${after.revocationReason}`);
  });

// ─── consent subcommand (DPDP India — on-chain Consent Manager) ───────────

const consentCmd = program
  .command('consent')
  .description('DPDP India Consent Manager — record / revoke / query on-chain consent (Frente 1)');

consentCmd
  .command('record')
  .description('Record a consent event (fiduciary path) — signer is the data fiduciary')
  .option('-c, --cluster <name>', 'cluster: localnet | devnet | mainnet-beta', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-k, --keypair <path>', 'path to fiduciary keypair JSON', '~/.config/solana/id.json')
  .requiredOption('--user <pubkey>', 'user (data principal) Solana pubkey')
  .requiredOption('--purpose-code <u16>', 'numeric purpose code (0-65535)')
  .requiredOption('--purpose-text <string>', 'human-readable purpose — hashed (sha256) to purpose_hash')
  .option('--storage-uri <uri>', 'off-chain evidence URI (max 128 bytes) — set this OR --upload, not both', '')
  .option('--upload <file>', 'upload file via --backend before recording; sets storage_uri to returned URL')
  .option('--backend <kind>', 'storage backend for --upload: mock | ipfs | shdw', 'mock')
  .option('--shdw-storage-account <pubkey>', 'Shadow Drive v1 storage account (required if --backend shdw)')
  .option('--encrypt-key <hex>', 'optional hex-encoded 32-byte AES-256-GCM key; encrypts payload before upload. Keep the key — required to fetch later.')
  .option('--expires-at <unixSec>', 'unix timestamp when consent expires (optional)')
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const user = new PublicKey(opts.user);
    const purposeCode = Number.parseInt(opts.purposeCode, 10);
    if (!Number.isInteger(purposeCode) || purposeCode < 0 || purposeCode > 65535) {
      throw new Error('purpose-code must be an integer in [0, 65535]');
    }
    if (opts.upload && opts.storageUri) {
      throw new Error('pass --upload OR --storage-uri, not both');
    }
    const expiresAt = opts.expiresAt ? BigInt(opts.expiresAt) : null;

    const client = new DPO2UConsentClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    let storageUri = opts.storageUri;
    if (opts.upload) {
      const backend = await buildBackend({
        backend: opts.backend,
        cluster: opts.cluster,
        url: opts.url,
        signer,
        shdwStorageAccount: opts.shdwStorageAccount,
        encryptKey: opts.encryptKey,
      });
      const payload = readFileSync(opts.upload);
      const name = path.basename(opts.upload);
      storageUri = await backend.upload(new Uint8Array(payload), name);
      const encLabel = opts.encryptKey ? ' encrypted=aes-256-gcm' : '';
      console.log(`✓ payload uploaded : ${storageUri} (backend=${backend.kind}${encLabel})`);
    }

    const purposeHash = DPO2UConsentClient.purposeHashFromText(opts.purposeText);
    console.log(`data fiduciary : ${signer.publicKey.toBase58()}`);
    console.log(`user           : ${user.toBase58()}`);
    console.log(`purpose_code   : ${purposeCode}`);
    console.log(`purpose_text   : "${opts.purposeText}"`);
    console.log(`purpose_hash   : 0x${Buffer.from(purposeHash).toString('hex')}`);
    console.log(`storage_uri    : ${storageUri || '(empty)'}`);
    console.log(`expires_at     : ${expiresAt ?? 'never'}`);
    console.log('submitting tx...');

    const res = await client.recordConsent({
      user,
      purposeCode,
      purposeText: opts.purposeText,
      storageUri,
      expiresAt,
    });

    console.log();
    console.log(`✓ signature      : ${res.signature}`);
    console.log(`✓ consent PDA    : ${res.consentPda.toBase58()}`);
    console.log(`✓ Explorer       : ${res.explorerUrl}`);
  });

consentCmd
  .command('revoke')
  .description('Revoke a consent (DPDP §6(4) — only the user may revoke)')
  .option('-c, --cluster <name>', 'cluster', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-k, --keypair <path>', 'path to user keypair JSON', '~/.config/solana/id.json')
  .requiredOption('--consent-pda <pubkey>', 'consent PDA to revoke')
  .requiredOption('--reason <string>', 'revocation reason (<=64 bytes)')
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const consent = new PublicKey(opts.consentPda);
    if (opts.reason.length > 64) {
      throw new Error(`reason must be <= 64 bytes (got ${opts.reason.length})`);
    }

    const client = new DPO2UConsentClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    console.log(`user (signer) : ${signer.publicKey.toBase58()}`);
    console.log(`consent PDA   : ${consent.toBase58()}`);
    console.log(`reason        : ${opts.reason}`);
    console.log('submitting revoke tx...');

    const res = await client.revokeConsent({ consent, reason: opts.reason });
    console.log();
    console.log(`✓ signature      : ${res.signature}`);
    console.log(`✓ Explorer       : ${res.explorerUrl}`);
  });

consentCmd
  .command('query')
  .description('Fetch a consent PDA by (user, fiduciary, purpose) and pretty-print')
  .option('-c, --cluster <name>', 'cluster', 'devnet')
  .option('-u, --url <rpc>', 'override RPC URL')
  .option('-k, --keypair <path>', 'keypair (used only for connection)', '~/.config/solana/id.json')
  .requiredOption('--user <pubkey>', 'user Solana pubkey')
  .requiredOption('--fiduciary <pubkey>', 'data fiduciary Solana pubkey')
  .requiredOption('--purpose-text <string>', 'purpose text (will be hashed)')
  .action(async (opts) => {
    const signer = loadKeypair(opts.keypair);
    const user = new PublicKey(opts.user);
    const fiduciary = new PublicKey(opts.fiduciary);
    const purposeHash = DPO2UConsentClient.purposeHashFromText(opts.purposeText);

    const client = new DPO2UConsentClient({
      cluster: opts.cluster as ClusterName,
      rpcUrl: opts.url,
      signer,
    });

    const rec = await client.fetchConsent(user, fiduciary, purposeHash);
    if (!rec) {
      console.log('no consent found for this (user, fiduciary, purpose_hash)');
      process.exit(1);
    }
    console.log(JSON.stringify(
      {
        user: rec.user.toBase58(),
        dataFiduciary: rec.dataFiduciary.toBase58(),
        purposeCode: rec.purposeCode,
        purposeHash: `0x${Buffer.from(rec.purposeHash).toString('hex')}`,
        storageUri: rec.storageUri,
        issuedAt: rec.issuedAt.toString(),
        expiresAt: rec.expiresAt?.toString() ?? null,
        revokedAt: rec.revokedAt?.toString() ?? null,
        revocationReason: rec.revocationReason,
        version: rec.version,
        verified: rec.verified,
        threshold: rec.threshold,
      },
      null,
      2,
    ));
  });

// ─── auth subcommands (login / logout / whoami) ────────────────────────────

program
  .command('login')
  .description('OAuth login via browser — grants access to MCP audit/docs/submit tools (KYC via email allowlist)')
  .option('--endpoint <url>', 'MCP server URL', 'https://mcp.dpo2u.com')
  .option('--port <n>', 'loopback port (default: random)')
  .action(async (opts) => {
    const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
    console.log(`DPO2U Login — endpoint: ${opts.endpoint}`);
    console.log('Opening browser for authentication...\n');
    try {
      const token = await oauthLogin({
        endpoint: opts.endpoint,
        port,
        onAuthUrl: (url) => {
          console.log('If the browser did not open, visit:');
          console.log(`  ${url}\n`);
        },
      });
      const expiresIn = Math.round((token.expires_at - Date.now()) / 1000 / 60);
      console.log('✓ authorized');
      console.log(`  token saved: ${defaultTokenPath()}`);
      console.log(`  expires in:  ${expiresIn} min`);
      console.log(`  client_id:   ${token.client_id}`);
      console.log(`  endpoint:    ${token.endpoint}`);
      console.log();
      console.log('Now MCPClient (SDK) and this CLI will auto-load this token.');
    } catch (err: any) {
      console.error('✗ login failed:', err.message ?? err);
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Delete the local OAuth token')
  .action(() => {
    const path = defaultTokenPath();
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`✓ removed ${path}`);
    } else {
      console.log(`no token at ${path}`);
    }
  });

program
  .command('whoami')
  .description('Show current OAuth token info (if logged in)')
  .action(() => {
    const saved = loadSavedToken();
    if (!saved) {
      console.log('not logged in. Run: dpo2u-cli login');
      process.exit(1);
    }
    const expiresIn = Math.round((saved.expires_at - Date.now()) / 1000 / 60);
    console.log(JSON.stringify({
      endpoint: saved.endpoint,
      client_id: saved.client_id,
      expires_in_minutes: expiresIn,
      scope: saved.scope,
      path: defaultTokenPath(),
    }, null, 2));
  });

program.parseAsync(process.argv).catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
