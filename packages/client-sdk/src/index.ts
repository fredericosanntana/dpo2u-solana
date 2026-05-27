/**
 * @dpo2u/client-sdk — public API.
 *
 * See `DPO2UClient` for the high-level interface. Types are re-exported for
 * consumers that want to build their own transactions.
 */

export { DPO2UClient, PROGRAM_IDS, VERIFIER_PROGRAM_ID } from './client.js';
export type {
  AttestationRecord,
  AttestWithProofArgs,
  ClusterName,
  DPO2UClientOptions,
} from './client.js';

export { DPO2UConsentClient, CONSENT_MANAGER_PROGRAM_ID } from './consent.js';
export type {
  ConsentRecord,
  DPO2UConsentClientOptions,
  RecordConsentArgs,
  RecordVerifiedConsentArgs,
} from './consent.js';

export { MCPClient, MCPClientError } from './mcp.js';
export type {
  MCPClientOptions,
  OnChainTxResult,
  SubmitConsentRecordResult,
  SubmitConsentRevokeResult,
  FetchConsentResult,
  SubmitAttestationResult,
  FetchAttestationResult,
} from './mcp.js';

export {
  login as oauthLogin,
  loadSavedToken,
  saveToken,
  defaultTokenPath,
  OAuthError,
} from './oauth.js';
export type { LoginOptions, SavedToken } from './oauth.js';

// -- Sprint D — 4 jurisdiction-specific clients (deployed devnet 2026-05-01) --

export { DPO2UPopiaClient, POPIA_INFO_OFFICER_PROGRAM_ID } from './popia.js';
export type { DPO2UPopiaClientOptions, RegisterAppointmentArgs } from './popia.js';

export { DPO2UCcpaClient, CCPA_OPTOUT_PROGRAM_ID, OPTOUT_KIND } from './ccpa.js';
export type { DPO2UCcpaClientOptions, RegisterOptoutArgs, OptoutKind } from './ccpa.js';

export { DPO2UPipedaClient, PIPEDA_CONSENT_EXT_PROGRAM_ID, CONSENT_FORM } from './pipeda.js';
export type { DPO2UPipedaClientOptions, RecordPipedaConsentArgs, ConsentForm } from './pipeda.js';

export { DPO2UPipaClient, PIPA_KOREA_ZK_ID_PROGRAM_ID, ATTRIBUTE_KIND } from './pipa.js';
export type { DPO2UPipaClientOptions, IssueAttestationArgs, AttributeKind } from './pipa.js';

// Hiroshima AI Process attestation (cross-framework G7 ICOC + AIBOG + DS-920).
// Minimal client surface focused on verify_against_legal_manifest — added 2026-05-15.
export {
  DPO2UHiroshimaClient,
  HIROSHIMA_AI_PROCESS_PROGRAM_ID,
  HIROSHIMA_ATTESTATION_TYPE,
} from './hiroshima.js';
export type { DPO2UHiroshimaClientOptions, HiroshimaAttestationType } from './hiroshima.js';

// Agent Registry — MCP whitelist + 5-actor value chain (Sprint Continuable round 2 2026-05-15).
// Built + IDL shipped; on-chain upgrade pending devnet airdrop window.
export {
  DPO2UAgentRegistryClient,
  AGENT_REGISTRY_PROGRAM_ID,
  VALUE_CHAIN_ROLE,
} from './agent-registry.js';
export type { DPO2UAgentRegistryClientOptions, ValueChainRole } from './agent-registry.js';

// -- Composed Stack (Fase 3) — Light Protocol + Pinocchio + Shadow Drive + Squads --
//
// Photon Indexer wrapper + composed flow function. Use submitComposedAttestation
// to submit one attestation atomically (Shadow upload + SP1 verify + Light insert
// gated by Squads vault authority for revoke).

export { PhotonClient } from './photon.js';
export type {
  PhotonClientOptions,
  MerkleProofResponse,
  CompressedAccountData,
} from './photon.js';

export {
  submitComposedAttestation,
  COMPLIANCE_PINOCCHIO_PROGRAM_ID,
  SP1_VERIFIER_PROGRAM_ID,
  LIGHT_SYSTEM_PROGRAM_ID,
} from './composed.js';
export type {
  ComposedAttestationParams,
  ComposedAttestationResult,
  Jurisdiction,
} from './composed.js';

// -- Kolibri seed-to-sale traceability (2026-05-27) — selector 0x06 in Pinocchio --
//
// Anchors plant lifecycle events on Solana (15 event types), gated by
// agent-registry (cultivator/dispensary/lab must be pre-registered).

export {
  DPO2UCannabisClient,
  CANNABIS_EVENT_TYPE,
  ROOT_BATCH_ID,
  deriveCannabisEventPda,
  deriveAgentPda as deriveAgentPdaFromCannabis,
  buildSubmitCannabisEventIx,
  encodeSubmitCannabisEvent,
} from './cannabis.js';
export type {
  DPO2UCannabisClientOptions,
  SubmitCannabisEventArgs,
  SubmitCannabisEventResult,
  CannabisEventType,
} from './cannabis.js';

// -- Legal Corpus Sprint (2026-05-14) — legal_source_manifest deployed devnet --
//
// On-chain pointer to the off-chain legal corpus produced by dpo2u-legal-worker.
// Reading the PDA's content_hash and matching it to the worker's manifest.json
// proves which version of the law a downstream attestation was evaluated against.

export {
  DPO2ULegalManifestClient,
  LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
  JURISDICTION_SEED_LEN,
} from './legal-manifest.js';
export type {
  DPO2ULegalManifestClientOptions,
  InitManifestArgs,
  UpdateManifestArgs,
  TransferAuthorityArgs,
  LegalSourceManifestAccount,
} from './legal-manifest.js';
