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
