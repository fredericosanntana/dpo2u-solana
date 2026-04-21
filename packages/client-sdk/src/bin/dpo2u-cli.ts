#!/usr/bin/env node
/**
 * dpo2u-cli — drive DPO2UClient from the command line.
 *
 * Subcommands:
 *   attest      submit a verified attestation using a committed proof
 *   fetch       fetch a subject's attestation PDA and pretty-print
 */

import { Command } from 'commander';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { DPO2UClient, type ClusterName } from '../client.js';

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
  .option('--storage-uri <uri>', 'off-chain DPIA pointer', 'ipfs://QmDPO2UDemo')
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

    // Commitment is always derived from the proof's public values to guarantee
    // they match. The --subject-label is just informational.
    const expectedCommitment = Buffer.from(publicValues.slice(32, 64));
    console.log(`subject      : ${subject.toBase58()}`);
    console.log(`label        : "${opts.subjectLabel}"`);
    console.log(`commitment   : 0x${expectedCommitment.toString('hex')}`);
    console.log(`cluster      : ${opts.cluster}`);
    console.log('submitting tx...');

    const result = await client.attestWithProof({
      subject,
      proof: new Uint8Array(proof),
      publicInputs: new Uint8Array(publicValues),
      storageUri: opts.storageUri,
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

program.parseAsync(process.argv).catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
