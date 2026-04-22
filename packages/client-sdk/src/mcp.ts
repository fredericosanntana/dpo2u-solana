/**
 * MCPClient — thin typed wrapper around the DPO2U MCP server REST API.
 *
 * Exposes the full tool surface (on-chain submit/revoke/fetch + audit/docs
 * generation + FHE analytics) through a single client. Uses native `fetch`
 * (Node 18+). No dependency on Solana keypair management — for on-chain
 * writes, the server signs with its own wallet (for quick validation); for
 * production, use the native `DPO2UClient` / `DPO2UConsentClient` paths
 * with your own keystore.
 *
 * Why this exists: lets JS/TS integrators call `check_compliance`,
 * `generate_dpia`, `audit_micar_art`, etc. without writing `fetch()`
 * boilerplate, and gives on-chain submit tools the same ergonomic shape.
 *
 * Example:
 *   ```ts
 *   import { MCPClient } from '@dpo2u/client-sdk';
 *
 *   const mcp = new MCPClient({
 *     endpoint: 'https://mcp.dpo2u.com',
 *     apiKey: process.env.DPO2U_API_KEY,
 *   });
 *
 *   // on-chain
 *   const consent = await mcp.submitConsentRecord({
 *     user: 'HthjMxo...',
 *     purposeCode: 1,
 *     purposeText: 'marketing_communications',
 *   });
 *   console.log(consent.explorerUrl);
 *
 *   // audit/docs
 *   const matrix = await mcp.compareJurisdictions({
 *     targetMarkets: ['BR', 'EU', 'INDIA'],
 *     focus: 'onchain',
 *   });
 *   ```
 */

export interface MCPClientOptions {
  /** Base URL of the MCP REST server. Default: https://mcp.dpo2u.com */
  endpoint?: string;
  /** JWT API key (x-api-key header). Required for authenticated endpoints. */
  apiKey?: string;
  /** Override default fetch (useful for testing / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in ms. Default: 120_000 (some tools chain LLM calls). */
  timeoutMs?: number;
}

export class MCPClientError extends Error {
  constructor(
    msg: string,
    public status?: number,
    public responseBody?: unknown,
  ) {
    super(msg);
    this.name = 'MCPClientError';
  }
}

/**
 * Result envelopes
 */
export interface OnChainTxResult {
  signature: string;
  explorerUrl: string;
  cluster: string;
}

export interface SubmitConsentRecordResult extends OnChainTxResult {
  consentPda: string;
  fiduciary: string;
  purposeHashHex: string;
}

export interface SubmitConsentRevokeResult extends OnChainTxResult {
  userPubkey: string;
}

export interface FetchConsentResult {
  found: boolean;
  record: null | {
    pda: string;
    user: string;
    dataFiduciary: string;
    purposeCode: number;
    purposeHashHex: string;
    storageUri: string;
    issuedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
    version: number;
    verified: boolean;
    threshold: number;
  };
  derivedPurposeHashHex?: string;
}

export interface SubmitAttestationResult extends OnChainTxResult {
  attestationPda: string;
  issuer: string;
  commitmentHex?: string;
}

export interface FetchAttestationResult {
  found: boolean;
  record: null | {
    pda: string;
    subject: string;
    issuer: string;
    schemaId: string;
    commitmentHex: string;
    storageUri: string;
    issuedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
    version: number;
    verified: boolean;
    threshold: number;
  };
  derivedCommitmentHex?: string;
}

const DEFAULT_ENDPOINT = 'https://mcp.dpo2u.com';
const DEFAULT_TIMEOUT_MS = 120_000;

export class MCPClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MCPClientOptions = {}) {
    this.endpoint = (opts.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.fetchImpl) {
      throw new Error('MCPClient: global fetch not available. Upgrade to Node 18+ or pass opts.fetchImpl.');
    }
  }

  /** Generic tool dispatcher. Use the typed methods below for better DX. */
  async call<T = unknown>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const url = `${this.endpoint}/tools/${toolName}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
      const contentType = resp.headers.get('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const body = isJson ? await resp.json() : await resp.text();
      if (!resp.ok) {
        throw new MCPClientError(
          `MCP tool ${toolName} failed with HTTP ${resp.status}`,
          resp.status,
          body,
        );
      }
      // REST wrapper returns { success: true, result: ... }; unwrap if present
      if (isJson && body && typeof body === 'object' && 'success' in body && 'result' in body) {
        return (body as any).result as T;
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Meta ─────────────────────────────────────────────────────────────

  async health(): Promise<unknown> {
    const resp = await this.fetchImpl(`${this.endpoint}/health`);
    return await resp.json();
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    const resp = await this.fetchImpl(`${this.endpoint}/tools`);
    const body: any = await resp.json();
    return body.tools ?? [];
  }

  async openapi(): Promise<unknown> {
    const resp = await this.fetchImpl(`${this.endpoint}/openapi.json`);
    return await resp.json();
  }

  // ─── On-chain (DPDP consent-manager + LGPD/GDPR compliance-registry) ────

  submitConsentRecord(args: {
    user: string;
    purposeCode: number;
    purposeText: string;
    storageUri?: string;
    expiresAt?: number;
  }): Promise<SubmitConsentRecordResult> {
    return this.call('submit_consent_record', args);
  }

  submitConsentRevoke(args: {
    consentPda: string;
    reason: string;
    userSignerBase58: string;
  }): Promise<SubmitConsentRevokeResult> {
    return this.call('submit_consent_revoke', args);
  }

  fetchConsentRecord(args: {
    user: string;
    dataFiduciary: string;
    purposeText?: string;
    purposeHashHex?: string;
  }): Promise<FetchConsentResult> {
    return this.call('fetch_consent_record', args);
  }

  submitComplianceAttestation(args: {
    subject: string;
    commitmentHex?: string;
    commitmentText?: string;
    storageUri?: string;
    schemaIdBase58?: string;
    expiresAt?: number;
  }): Promise<SubmitAttestationResult> {
    return this.call('submit_compliance_attestation', args);
  }

  submitVerifiedComplianceAttestation(args: {
    subject: string;
    commitmentHex: string;
    proofHex: string;
    publicInputsHex: string;
    storageUri?: string;
    schemaIdBase58?: string;
    expiresAt?: number;
  }): Promise<SubmitAttestationResult> {
    return this.call('submit_verified_compliance_attestation', args);
  }

  revokeComplianceAttestation(args: {
    attestationPda: string;
    reason: string;
    altSignerBase58?: string;
  }): Promise<OnChainTxResult & { signer: string }> {
    return this.call('revoke_compliance_attestation', args);
  }

  fetchComplianceAttestation(args: {
    subject: string;
    commitmentHex?: string;
    commitmentText?: string;
  }): Promise<FetchAttestationResult> {
    return this.call('fetch_compliance_attestation', args);
  }

  // ─── Audit & documentation ───────────────────────────────────────────────

  checkCompliance(args: {
    company: string;
    auditScope: string;
    framework: 'LGPD' | 'GDPR' | 'Ambos';
    jurisdiction?: 'LGPD' | 'GDPR' | 'DPDP' | 'MICAR' | 'PDPA' | 'UAE';
    cnpj?: string;
    hasDPO?: boolean;
    hasPrivacyPolicy?: boolean;
    hasDataMapping?: boolean;
    hasIncidentResponsePlan?: boolean;
    hasDataBreachProtocol?: boolean;
    hasDataProcessingAgreement?: boolean;
    hasAuditProgram?: boolean;
    hasDataRetentionPolicy?: boolean;
    hasCookieConsent?: boolean;
    internationalTransfer?: boolean;
    auditorName?: string;
    auditorRole?: string;
  }): Promise<unknown> {
    return this.call('check_compliance', args);
  }

  calculatePrivacyScore(args: Record<string, unknown>): Promise<unknown> {
    return this.call('calculate_privacy_score', args);
  }

  generateDpiaStored(args: {
    company: string;
    processingActivity: string;
    dataTypes: string[];
    dataSubjects: string[];
    purpose: string;
    registerOnChain?: boolean;
  }): Promise<unknown> {
    return this.call('generate_dpia_stored', args);
  }

  generateAuditStored(args: Record<string, unknown>): Promise<unknown> {
    return this.call('generate_audit_stored', args);
  }

  generatePrivacyPolicy(args: Record<string, unknown>): Promise<unknown> {
    return this.call('generate_privacy_policy', args);
  }

  generateSecurityPolicy(args: Record<string, unknown>): Promise<unknown> {
    return this.call('generate_security_policy', args);
  }

  generateTermsOfUse(args: Record<string, unknown>): Promise<unknown> {
    return this.call('generate_terms_of_use', args);
  }

  // ─── Cross-jurisdiction ─────────────────────────────────────────────────

  compareJurisdictions(args: {
    targetMarkets?: string[];
    focus?: 'all' | 'crypto' | 'ai' | 'data' | 'onchain';
  } = {}): Promise<{
    matrix: Array<{
      code: string;
      name: string;
      country: string;
      cryptoMaturity: string;
      aiRegulation: string;
      dataProtection: string;
      bestUseCase: string;
      keyInsight: string;
      onChainOpportunity?: { target: string; architecture: string; regulatoryFit: string };
    }>;
    recommendation: string;
    focus: string;
    metadata: { generatedAt: number; jurisdictionsCovered: number };
  }> {
    return this.call('compare_jurisdictions', args);
  }

  generateConsentManagerPlan(args: {
    organizationName: string;
    organizationPubkey?: string;
    purposes?: Array<{ code: number; name: string; description?: string }>;
    useZkProof?: boolean;
    dataBoardRegistration?: boolean;
  }): Promise<unknown> {
    return this.call('generate_consent_manager_plan', args);
  }

  auditMicarArt(args: {
    vaultPda?: string;
    programId?: string;
    cluster?: 'devnet' | 'mainnet-beta' | 'localnet';
    rpcUrl?: string;
    vault?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.call('audit_micar_art', args);
  }

  generateAdgmFoundationCharter(args: {
    foundationName: string;
    protocolPurpose: string;
    initialCouncillors: string[];
    guardianMultisig?: string;
    registeredAgent?: string;
  }): Promise<unknown> {
    return this.call('generate_adgm_foundation_charter', args);
  }

  generateAiverifyPluginTemplate(args: {
    modelType?: 'pytorch' | 'sklearn' | 'onnx';
    metric?: 'fairness' | 'robustness' | 'accuracy' | 'explainability';
    operatorAuthority?: string;
    includeAnchoringScript?: boolean;
  } = {}): Promise<unknown> {
    return this.call('generate_aiverify_plugin_template', args);
  }
}
