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
