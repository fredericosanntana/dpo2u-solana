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
