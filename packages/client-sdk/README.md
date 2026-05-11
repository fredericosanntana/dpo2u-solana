# `@dpo2u/client-sdk`

TypeScript client for [`dpo2u-solana`](https://github.com/fredericosanntana/dpo2u-solana) — on-chain compliance attestations, DPDP India Consent Manager, and AES-GCM encrypted off-chain storage.

Built for **LGPD** (Brazil), **GDPR** (EU), **DPDP** (India), **MiCAR** (EU), **PDPA** (Singapore), and **ADGM** (UAE) compliance workflows on Solana.

---

## Install

```bash
npm install @dpo2u/client-sdk
# or
pnpm add @dpo2u/client-sdk
```

The package ships the IDLs it needs (`compliance_registry.json`, `consent_manager.json`) bundled in `dist/idl/` — no Anchor build required on the consumer side.

---

## CLI

A global CLI ships with the package. Use it directly via `npx`:

```bash
npx dpo2u-cli --help

# LGPD / GDPR — submit a ZK-verified attestation
npx dpo2u-cli attest \
  --cluster devnet \
  --keypair ~/.config/solana/id.json \
  --subject-label "did:br:cnpj:12.345.678/0001-99" \
  --proof ./proof.bin \
  --public-values ./public_values.bin \
  --upload ./dpia.pdf \
  --backend shdw \
  --shdw-storage-account <PDA> \
  --encrypt-key $(openssl rand -hex 32)        # AES-GCM encrypt before upload

# DPDP India — record an on-chain Consent Event
npx dpo2u-cli consent record \
  --cluster devnet \
  --keypair ~/.config/solana/id.json \
  --user <USER_PUBKEY> \
  --purpose-code 1 \
  --purpose-text "marketing_communications" \
  --upload ./consent_terms.pdf \
  --encrypt-key <hex32>

# DPDP India — user revokes consent (§6(4))
npx dpo2u-cli consent revoke \
  --cluster devnet \
  --keypair <USER_KEYPAIR> \
  --consent-pda <PDA> \
  --reason "DPDP_SEC12_REQUEST_2026-04-22"

# LGPD Art. 18 — erase off-chain payload + revoke on-chain attestation
npx dpo2u-cli erase \
  --cluster mainnet-beta \
  --subject <SUBJECT> \
  --commitment 0x... \
  --reason "LGPD_ART_18_REQUEST_2026-04-22"
```

---

## Library usage

### 1 — Compliance attestation (LGPD/GDPR)

```ts
import { DPO2UClient } from '@dpo2u/client-sdk';
import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';

const signer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('./wallet.json', 'utf-8')))
);
const client = new DPO2UClient({ cluster: 'devnet', signer });

const { signature, attestationPda, explorerUrl } = await client.attestWithProof({
  subject: signer.publicKey,
  proof: readFileSync('./proof.bin'),
  publicInputs: readFileSync('./public_values.bin'),
  storageUri: 'ipfs://QmYourDPIADoc',
});

console.log(`Attestation → ${attestationPda.toBase58()}`);
console.log(`Explorer    → ${explorerUrl}`);
```

Automatically prepends `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` because the SP1 Groth16 CPI pairing check consumes ~156k CU.

### 2 — DPDP India Consent Manager

```ts
import { DPO2UConsentClient } from '@dpo2u/client-sdk';

const consent = new DPO2UConsentClient({ cluster: 'devnet', signer });

// Fiduciary records consent
const { consentPda } = await consent.recordConsent({
  user: userPubkey,
  purposeCode: 1,
  purposeText: 'marketing_communications',
  storageUri: 'ipfs://QmTermoAssinado',
});

// User later revokes — only the user may revoke (on-chain enforced)
await consent.revokeConsent({
  consent: consentPda,
  reason: 'DPDP_SEC12_REQUEST',
});
```

### 3 — Encrypted storage (AES-256-GCM envelope)

Wrap any `StorageBackend` with client-side encryption so public gateways (Shadow Drive, IPFS) never see plaintext PII:

```ts
import {
  ShdwDriveBackend,
  EncryptedStorageBackend,
  keyFromHex,
} from '@dpo2u/client-sdk';
import { randomBytes } from 'node:crypto';

const inner = await ShdwDriveBackend.init({ connection, wallet, storageAccount });
const key = new Uint8Array(randomBytes(32)); // or: keyFromHex(process.env.DPO2U_KEY)
const encrypted = new EncryptedStorageBackend(inner, key);

// Upload is automatically encrypted (magic | nonce | tag | ciphertext)
const url = await encrypted.upload(pdfBytes, 'dpia.pdf');
// Fetch decrypts transparently
const plaintext = await encrypted.fetch(url);

// Inner backend (what Shadow Drive actually stores) sees only ciphertext.
// Erasure: delete() is unchanged semantics.
```

Wire format: `[magic("DPO2U\x01") | nonce(12) | auth_tag(16) | ciphertext]`. Tamper attempts and wrong keys fail cleanly with `EncryptedBackendError`.

### 4 — Compliance erasure flow (LGPD Art. 18 / DPDP §12)

```ts
import { DPO2UClient, ShdwDriveBackend } from '@dpo2u/client-sdk';

// 1 — delete off-chain payload
await backend.delete(rec.storageUri);

// 2 — revoke on-chain (keeps audit trail)
await client.revokeAttestation({
  attestation: attestationPda,
  reason: 'LGPD_ART_18_REQUEST_2026-04-22',
});
// PDA now has { revoked_at: <timestamp>, revocation_reason: "..." }
// Commitment hash remains as non-PII evidence
```

---

## Layout

| Module | Purpose |
|---|---|
| `DPO2UClient` | `compliance-registry` — verified-attestation + revoke + fetch |
| `DPO2UConsentClient` | `consent-manager` — record / revoke / fetch consent (DPDP India) |
| `EncryptedStorageBackend` | AES-256-GCM envelope over any storage backend |
| `ShdwDriveBackend` | Shadow Drive v1 (mainnet-only, mutable, LGPD-compliant) |
| `IpfsBackend` | Public IPFS gateway (read-only) |
| `MockBackend` | In-memory backend for tests |
| `PROGRAM_IDS` / `CONSENT_MANAGER_PROGRAM_ID` / `VERIFIER_PROGRAM_ID` | Canonical devnet program addresses |

---

## Regulatory mapping

| Primitive | Satisfies |
|---|---|
| `create_verified_attestation` (SP1 ZK CPI) | LGPD Art. 38 DPIA · GDPR Art. 35 · DPDP §10(2)(c) |
| `record_consent` + SHA-256 purpose_hash | DPDP §6(1) (clear and specific purpose) |
| `revoke_consent` (user-only signer check) | DPDP §6(4) (withdrawal as easy as grant) |
| `EncryptedStorageBackend` + `delete()` | LGPD Art. 18 · GDPR Art. 17 · DPDP §12(3) |
| `ComputeBudgetProgram.setComputeUnitLimit(400k)` | Solana CU budget for pairing check (~156k CU) |

---

## License

MIT © DPO2U
