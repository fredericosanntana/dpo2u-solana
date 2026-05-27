# `@dpo2u/client-sdk/cannabis` — Kolibri seed-to-sale traceability

TypeScript client for anchoring cannabis plant lifecycle events on Solana via [`compliance-registry-pinocchio`](../../solana-programs/programs/compliance-registry-pinocchio/) **selector 0x06** (`submit_cannabis_event`).

Built for the **Kolibri** ERP/mobile app (Solana Seeker) to comply with **LGPD**, **ANVISA RDC 1.015/2026**, and **SNGPC** seed-to-sale traceability requirements in Brazil. Pluggable for multi-jurisdiction (METRC USA / BfArM DE) via the same primitive.

---

## What you get

- **15 lifecycle event types**, from `SEED_PLANTED` to `DESTROYED` — covering cultivo, colheita, secagem, cura, laboratório (COA), embalagem, transferência, dispensação, recall e descarte.
- **Genealogy via `parent_batch_id`** — clones reference their mother; harvest references the clone; lab samples reference the cured batch.
- **Cross-program agent-registry gate** — the wallet anchoring must be pre-registered as `cultivator:`, `dispensary:`, or `lab:` in [`agent-registry`](../../solana-programs/programs/agent-registry/).
- **Idempotent** — `(batch_id, event_type)` is a unique PDA; resubmitting the same event reverts with `0x3005`.
- **Cheap** — 5-11k CU per event (3-5x cheaper than equivalent Anchor program). ~0.003 SOL rent per PDA.
- **Privacy-preserving** — only `payload_hash` + `storage_uri` go on-chain. Real payload (fotos, COA PDF, condições ambientais) fica off-chain em Shadow Drive / IPFS.

---

## Install

```bash
npm install @dpo2u/client-sdk @solana/web3.js ulid
# or
pnpm add @dpo2u/client-sdk @solana/web3.js ulid
```

---

## Quick start

```ts
import {
  DPO2UCannabisClient,
  CANNABIS_EVENT_TYPE,
  deriveCannabisEventPda,
} from '@dpo2u/client-sdk';
import { Keypair } from '@solana/web3.js';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';

const signer = Keypair.fromSecretKey(/* your secret key */);
const client = new DPO2UCannabisClient({ cluster: 'devnet', signer });

// 1. One-time: register the wallet as a cultivator/dispensary/lab in agent-registry
//    (or use scripts/register-agent.ts from kolibri-gateway/sample/)
await client.registerCultivator('00.000.000/0001-00', agentRegistryIdl);

// 2. Anchor a plant lifecycle event
const batchUlid = ulid();
const payload = {
  evt: 'MOTHER_REGISTERED',
  schema_v: 1,
  cultivar_full: "Charlotte's Web F2",
  genotype: '70% indica / 30% sativa',
  ts: Math.floor(Date.now() / 1000),
};
const canonicalJson = JSON.stringify(payload); // use canonicalize() for production
const payloadHash = createHash('sha256').update(canonicalJson).digest();

const result = await client.submitEvent({
  agentName: 'cultivator:00.000.000/0001-00',
  batchId: ulidToBytes(batchUlid),
  eventType: CANNABIS_EVENT_TYPE.MOTHER_REGISTERED,
  payloadHash,
  storageUri: 'ipfs://Qm.../mother-registered.json', // or shadow://...
  cultivarCode: 'HEM:CBD1',
  emittedAt: BigInt(Math.floor(Date.now() / 1000)),
});

console.log(result.eventPda.toBase58()); // → e.g. HLpswBaH3ycuoukLgu7Vebkqyw1gA1YrHfTPuyCueX9B
console.log(result.signature);          // → tx sig
console.log(result.explorerUrl);        // → solscan link
```

---

## API

### `DPO2UCannabisClient`

| Method | Description |
|---|---|
| `new DPO2UCannabisClient({ cluster, signer })` | Construct a client for one role on one cluster |
| `submitEvent(args)` | Build + sign + submit one event tx. Returns `{ signature, eventPda, explorerUrl }` |
| `registerAgent(name, idl)` | Generic agent registration (any prefix) |
| `registerCultivator(cnpj, idl)` | Convenience: register as `cultivator:CNPJ` |
| `registerDispensary(cnpj, idl)` | Convenience: register as `dispensary:CNPJ` |
| `registerLab(cnpj, idl)` | Convenience: register as `lab:CNPJ` |
| `agentPdaFor(name)` | Derive the agent PDA for this client's signer + name |

### Standalone helpers

| Helper | Description |
|---|---|
| `CANNABIS_EVENT_TYPE` | Object mapping event names to their u8 codes (1..15) |
| `deriveCannabisEventPda(batchId, eventType)` | Deterministic PDA derivation |
| `deriveAgentPdaFromCannabis(authority, name)` | Agent PDA derivation (matches agent-registry seeds) |
| `buildSubmitCannabisEventIx(opts)` | Build the raw `TransactionInstruction` without sending (use in a backend that uses MWA-style signing on the client) |
| `encodeSubmitCannabisEvent(args)` | Just the Borsh-encoded ix data (for low-level use) |
| `ROOT_BATCH_ID` | 16 zero bytes — used as `parent_batch_id` for root events |

### 15 event types

| Code | Type | Role | Typical payload fields |
|---|---|---|---|
| 1 | `SEED_PLANTED` | cultivator | supplier, seed_lot_id, qty, location |
| 2 | `MOTHER_REGISTERED` | cultivator | cultivar_full, genotype, phenotype, photos[] |
| 3 | `CLONE_CUT` | cultivator | cut_count, cutting_method, hormone |
| 4 | `VEGETATION_START` | cultivator | light_hours, temp, humidity, nutrient_recipe |
| 5 | `FLOWERING_START` | cultivator | pinch_method, expected_harvest_date |
| 6 | `HARVEST` | cultivator | wet_weight_g, plant_count, trichome_status, photos[] |
| 7 | `DRYING_START` | cultivator | drying_method, target_humidity, target_temp |
| 8 | `CURING_START` | cultivator | container, batch_humidity, burping_schedule |
| 9 | `LAB_SAMPLE_TAKEN` | cultivator/lab | lab CNPJ, sample_qty, tracking |
| 10 | `LAB_RESULT_RELEASED` | lab | COA URI, THC%, CBD%, terpenes, lab signature |
| 11 | `PACKAGED` | cultivator | unit_size, units_count, qr_codes, expiration |
| 12 | `TRANSFERRED` | cultivator/dispensary | from/to CNPJ, transport invoice |
| 13 | `DISPENSED` | dispensary | patient_hash, prescription_hash, units |
| 14 | `RECALLED` | cultivator/dispensary/admin | mode, reason, anvisa_notice |
| 15 | `DESTROYED` | cultivator/admin | reason, method, witness, weight |

Full canonical JSON schemas (with all fields) in the [Kolibri gateway docs](../../../DPO2U/packages/kolibri-gateway/docs/event-schemas.md).

---

## How it integrates with Kolibri

```
React Native App (Seeker)
   │ HTTPS + Bearer JWT
   ▼
kolibri-gateway (Fastify @ dpo2u.com/kolibri)
   │
   ├─ uses @dpo2u/client-sdk/cannabis to build unsigned tx
   ├─ Mobile app signs via Mobile Wallet Adapter (MWA)
   └─ Gateway broadcasts signed tx and persists in Postgres
```

The gateway uses `buildSubmitCannabisEventIx` (not `client.submitEvent`) because the **mobile wallet signs the tx**, not the server. The gateway just constructs the unsigned tx, hands it off via base64, and broadcasts after receiving the signed bytes back.

See `/root/DPO2U/packages/kolibri-gateway/src/services/solana.service.ts` for the integration code.

---

## On-chain primitives used

| Program | Role |
|---|---|
| `compliance-registry-pinocchio` (`FZ21S53R…`) | Selector 0x06 handler — creates the CannabisEvent PDA |
| `agent-registry` (`5qeuUAa…`) | Cross-program ref — verifies the signer is a registered agent |
| `legal-source-manifest` (`eb579ft…`) | (Future) pin ANVISA RDC 1.015 + SNGPC corpus hash |
| `consent-manager` (`D5mLHU4…`) | (Future) patient recall notification consent |

---

## CU + cost budget

| Event type | Compute units (devnet) | Rent (one-time) |
|---|---|---|
| All 15 types | 5,000 – 11,000 CU | ~0.003 SOL |

Compare with an Anchor-based equivalent: ~25,000–30,000 CU + ~0.005 SOL rent. The Pinocchio port pays for the lower-level coding by giving back 3-5x compute headroom — crucial for cheap mainnet anchoring.

---

## Smoke + tests

```bash
# Unit tests (encoding, PDA derivation, validation)
pnpm test                                     # → 11/11 passing

# Devnet smoke (1 agent + 1 event)
node solana-programs/smoke-cannabis-event-devnet.mjs

# Anchor a real payload from a JSON file
node solana-programs/anchor-cannabis-event-real.mjs \
  --type MOTHER_REGISTERED \
  --cultivar HEM:CBD1 \
  --payload ./mother-payload.json \
  --agent "cultivator:00.000.000/0001-00"
```

---

## Status

- ✅ Selector 0x06 live on **Solana devnet** — upgrade tx [`43RX9bDK…7VK`](https://solscan.io/tx/43RX9bDKmfQ2dRV8CaZud1nfJaYPvLo6b67eFYckfF5xb5ahPxgrsFAXCTSD24jrrF89iynANFXCUSTEDYfd17VK?cluster=devnet) slot 465347314
- ✅ 8 bankrun tests passing (PDA + role + idempotency + 15 event types)
- ✅ 11 SDK unit tests passing
- ✅ Live E2E roundtrip via [`dpo2u.com/kolibri`](https://dpo2u.com/kolibri/openapi.json) — anchor [`vbvno2gb…STCi`](https://solscan.io/tx/vbvno2gb74XAGuUjhJW6xEpAJ8JBT51QvnHZZZShMbMRnZEJegL5bLRwCnC1ytcRkQu2AkcJYthz8WSGhh6STCi?cluster=devnet)
- ⏳ **Mainnet deploy** — gated on DPIA (LGPD Art. 38) + ROPA (Art. 37) closed by the Kolibri team

---

## License

Same as the rest of `@dpo2u/client-sdk` — see [LICENSE](./LICENSE).

DPO2U disponibiliza tudo open ao Kolibri — sem licença comercial, sem revenue share.
