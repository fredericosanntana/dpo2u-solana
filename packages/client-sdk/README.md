# `@dpo2u/client-sdk`

TypeScript client for [`dpo2u-solana`](../..) — build and submit
verified-attestation transactions from Node.

## Install

```bash
cd packages/client-sdk
pnpm install
pnpm build
```

> The SDK reads the `compliance_registry` IDL at runtime from
> `../../solana-programs/target/idl/compliance_registry.json`. Run
> `anchor build` inside `solana-programs/` first.

## CLI usage

```bash
# Submit a verified attestation (uses committed fixture proof by default)
./dist/bin/dpo2u-cli.js attest \
  --cluster devnet \
  --keypair ~/.config/solana/id.json \
  --subject-label "did:br:cnpj:12.345.678/0001-99"

# Read back the attestation
./dist/bin/dpo2u-cli.js fetch \
  --cluster devnet \
  --subject <subject-pubkey> \
  --commitment 0x0913644c8b396ebcee2b280e10247556a2f65c4a8e02242e5d041895cbddb043
```

## Library usage

```ts
import { DPO2UClient } from '@dpo2u/client-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';

const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('./wallet.json', 'utf-8')))
);

const client = new DPO2UClient({
  cluster: 'devnet',
  signer,
});

const proof = readFileSync('./zk-circuits/proofs/proof.bin');
const publicValues = readFileSync('./zk-circuits/proofs/public_values.bin');

const { signature, attestationPda, explorerUrl } = await client.attestWithProof({
  subject: signer.publicKey,        // or any other pubkey
  proof: new Uint8Array(proof),
  publicInputs: new Uint8Array(publicValues),
  storageUri: 'ipfs://QmYourDPIADoc',
});

console.log(`Attestation written to ${attestationPda.toBase58()}`);
console.log(`Explorer: ${explorerUrl}`);
```

Under the hood: `DPO2UClient.attestWithProof` prepends a
`ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` instruction
because the on-chain CPI to the Groth16 pairing check consumes ~156k CU,
and the default 200k is not enough.

## Layout

| File | Purpose |
|---|---|
| `src/client.ts` | `DPO2UClient` + PROGRAM_IDS constants |
| `src/bin/dpo2u-cli.ts` | `commander`-based CLI wrapper |
| `src/index.ts` | Public API re-exports |
