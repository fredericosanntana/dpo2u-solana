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
import { createStorageBackend, type BackendKind } from '../storage/index.js';

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
}) {
  const kind = opts.backend as BackendKind;
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
    return createStorageBackend('shdw', {
      connection,
      wallet: opts.signer,
      storageAccount: new PublicKey(opts.shdwStorageAccount),
      cluster: opts.cluster,
    });
  }
  return createStorageBackend(kind);
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
      });
      const payload = readFileSync(opts.upload);
      const name = path.basename(opts.upload);
      storageUri = await backend.upload(new Uint8Array(payload), name);
      console.log(`✓ payload uploaded : ${storageUri} (backend=${backend.kind})`);
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

program.parseAsync(process.argv).catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
