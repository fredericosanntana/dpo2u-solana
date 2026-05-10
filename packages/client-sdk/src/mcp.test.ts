/**
 * MCPClient — unit tests with a mock fetch implementation.
 * No real network calls — covers argument shape, URL construction, and
 * response envelope unwrapping.
 */

import { describe, it, expect, vi } from 'vitest';
import { MCPClient, MCPClientError } from './mcp.js';

function makeFetchMock(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return await impl(String(input), init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MCPClient — construction', () => {
  it('defaults endpoint to mcp.dpo2u.com', () => {
    const c = new MCPClient({ fetchImpl: makeFetchMock(() => jsonResponse({})) });
    // @ts-expect-error private access for test
    expect(c.endpoint).toBe('https://mcp.dpo2u.com');
  });

  it('trims trailing slash from endpoint', () => {
    const c = new MCPClient({
      endpoint: 'https://mcp.example.com/',
      fetchImpl: makeFetchMock(() => jsonResponse({})),
    });
    // @ts-expect-error private access
    expect(c.endpoint).toBe('https://mcp.example.com');
  });

  it('throws if no fetch available at all (no global, no impl)', () => {
    const originalFetch = globalThis.fetch;
    // Simulate ancient runtime by deleting global fetch
    // @ts-expect-error deliberately undefine for this test
    delete (globalThis as any).fetch;
    try {
      expect(() => new MCPClient({ fetchImpl: undefined as any })).toThrow(/fetch not available/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('MCPClient — call() generic dispatcher', () => {
  it('POSTs to /tools/<name> with JSON body and x-api-key header', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const fetchMock = makeFetchMock(async (url, init) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: { ok: true } });
    });

    const c = new MCPClient({
      endpoint: 'https://mcp.test',
      apiKey: 'jwt-key-xyz',
      fetchImpl: fetchMock,
    });
    const out = await c.call('some_tool', { foo: 'bar', n: 42 });

    expect(capturedUrl).toBe('https://mcp.test/tools/some_tool');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders['x-api-key']).toBe('jwt-key-xyz');
    expect(capturedBody).toEqual({ foo: 'bar', n: 42 });
    expect(out).toEqual({ ok: true });
  });

  it('unwraps REST envelope { success, result }', async () => {
    const c = new MCPClient({
      fetchImpl: makeFetchMock(() =>
        jsonResponse({ success: true, result: { unwrapped: 'yes' } }),
      ),
    });
    const out = await c.call('t', {});
    expect(out).toEqual({ unwrapped: 'yes' });
  });

  it('returns raw body if no envelope', async () => {
    const c = new MCPClient({
      fetchImpl: makeFetchMock(() => jsonResponse({ plain: 'response' })),
    });
    const out = await c.call('t', {});
    expect(out).toEqual({ plain: 'response' });
  });

  it('throws MCPClientError on non-2xx', async () => {
    const c = new MCPClient({
      fetchImpl: makeFetchMock(() => jsonResponse({ error: 'nope' }, 500)),
    });
    await expect(c.call('t', {})).rejects.toThrow(MCPClientError);
  });

  it('MCPClientError carries status + responseBody', async () => {
    const c = new MCPClient({
      fetchImpl: makeFetchMock(() => jsonResponse({ error: 'bad input' }, 400)),
    });
    try {
      await c.call('t', {});
    } catch (e) {
      expect(e).toBeInstanceOf(MCPClientError);
      expect((e as MCPClientError).status).toBe(400);
      expect((e as MCPClientError).responseBody).toEqual({ error: 'bad input' });
    }
  });

  it('omits x-api-key header when apiKey not provided', async () => {
    let capturedHeaders: Record<string, string> = {};
    const c = new MCPClient({
      fetchImpl: makeFetchMock((_url, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return jsonResponse({});
      }),
    });
    await c.call('t', {});
    expect(capturedHeaders['x-api-key']).toBeUndefined();
  });
});

describe('MCPClient — on-chain typed methods', () => {
  it('submitConsentRecord maps to submit_consent_record', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({
        success: true,
        result: {
          signature: 'abc',
          consentPda: 'pda123',
          explorerUrl: 'https://explorer.solana.com/tx/abc?cluster=devnet',
          cluster: 'devnet',
          fiduciary: 'fid',
          purposeHashHex: '0'.repeat(64),
        },
      });
    });
    const c = new MCPClient({ endpoint: 'https://m.x', fetchImpl: fetchMock });
    const out = await c.submitConsentRecord({
      user: 'UserPk',
      purposeCode: 1,
      purposeText: 'x',
    });
    expect(capturedUrl).toContain('/tools/submit_consent_record');
    expect(capturedBody).toEqual({ user: 'UserPk', purposeCode: 1, purposeText: 'x' });
    expect(out.signature).toBe('abc');
    expect(out.consentPda).toBe('pda123');
  });

  it('submitConsentRevoke requires userSignerBase58', async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: true, result: { signature: 's', explorerUrl: 'u', cluster: 'devnet', userPubkey: 'pk' } }),
    );
    const c = new MCPClient({ fetchImpl: fetchMock });
    const out = await c.submitConsentRevoke({
      consentPda: 'pda',
      reason: 'r',
      userSignerBase58: 'secret',
    });
    expect(out.signature).toBe('s');
  });

  it('fetchConsentRecord handles null record', async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ success: true, result: { found: false, record: null } }),
    );
    const c = new MCPClient({ fetchImpl: fetchMock });
    const out = await c.fetchConsentRecord({
      user: 'u',
      dataFiduciary: 'f',
      purposeText: 't',
    });
    expect(out.found).toBe(false);
    expect(out.record).toBeNull();
  });
});

describe('MCPClient — audit/docs typed methods', () => {
  it('compareJurisdictions passes focus onchain', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({
        success: true,
        result: {
          matrix: [{ code: 'LGPD', name: 'n', country: 'BR', cryptoMaturity: 'Medium', aiRegulation: 'Emerging', dataProtection: 'Strong', bestUseCase: 'x', keyInsight: 'y' }],
          recommendation: 'r',
          focus: 'onchain',
          metadata: { generatedAt: 1, jurisdictionsCovered: 1 },
        },
      });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    const out = await c.compareJurisdictions({ targetMarkets: ['BR'], focus: 'onchain' });
    expect(capturedBody.focus).toBe('onchain');
    expect(out.matrix.length).toBe(1);
    expect(out.matrix[0].code).toBe('LGPD');
  });

  it('compareJurisdictions accepts EMEA codes (POPIA, NDPA, PDPL)', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({
        success: true,
        result: {
          matrix: [
            { code: 'POPIA', name: 'POPIA', country: 'ZA', cryptoMaturity: 'High', aiRegulation: 'Nascent', dataProtection: 'Strong', bestUseCase: 'SADC gateway', keyInsight: 'k' },
            { code: 'NDPA',  name: 'NDPA',  country: 'NG', cryptoMaturity: 'High', aiRegulation: 'Emerging', dataProtection: 'Strong', bestUseCase: 'WAfrica fintech', keyInsight: 'k' },
            { code: 'UAE',   name: 'UAE',   country: 'AE', cryptoMaturity: 'Very High', aiRegulation: 'Pro-innovation', dataProtection: 'Strong', bestUseCase: 'ADGM foundation', keyInsight: 'k' },
          ],
          recommendation: 'EMEA stack',
          focus: 'all',
          metadata: { generatedAt: 1, jurisdictionsCovered: 3 },
        },
      });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    const out = await c.compareJurisdictions({ targetMarkets: ['POPIA', 'NDPA', 'PDPL'] });
    expect(capturedBody.targetMarkets).toEqual(['POPIA', 'NDPA', 'PDPL']);
    expect(out.matrix.map((m) => m.code).sort()).toEqual(['NDPA', 'POPIA', 'UAE']);
  });

  it('checkCompliance accepts POPIA jurisdiction', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme ZA',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'POPIA',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('POPIA');
  });

  it('checkCompliance accepts NDPA jurisdiction', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme NG',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'NDPA',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('NDPA');
  });

  it('compareJurisdictions accepts Americas codes (CCPA, PIPEDA, LAW25)', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({
        success: true,
        result: {
          matrix: [
            { code: 'CCPA',   name: 'CCPA',   country: 'US', cryptoMaturity: 'High', aiRegulation: 'Strong (state)', dataProtection: 'Strong', bestUseCase: 'US enterprise', keyInsight: 'k' },
            { code: 'PIPEDA', name: 'PIPEDA', country: 'CA', cryptoMaturity: 'Medium-High', aiRegulation: 'Voluntary', dataProtection: 'Strong (EU-adequate)', bestUseCase: 'NA bridge', keyInsight: 'k' },
            { code: 'LAW25',  name: 'LAW25',  country: 'CA', cryptoMaturity: 'Medium-High', aiRegulation: 'Strong', dataProtection: 'Very Strong', bestUseCase: 'GDPR-equivalent NA', keyInsight: 'k' },
          ],
          recommendation: 'Americas stack',
          focus: 'all',
          metadata: { generatedAt: 1, jurisdictionsCovered: 3 },
        },
      });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    const out = await c.compareJurisdictions({ targetMarkets: ['CCPA', 'PIPEDA', 'LAW25'] });
    expect(capturedBody.targetMarkets).toEqual(['CCPA', 'PIPEDA', 'LAW25']);
    expect(out.matrix.map((m) => m.code).sort()).toEqual(['CCPA', 'LAW25', 'PIPEDA']);
  });

  it('checkCompliance accepts CCPA jurisdiction', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme US',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'CCPA',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('CCPA');
  });

  it('checkCompliance accepts PIPEDA jurisdiction', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme Canada',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'PIPEDA',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('PIPEDA');
  });

  it('checkCompliance accepts LAW25 jurisdiction (Quebec)', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme Quebec',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'LAW25',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('LAW25');
  });

  it('checkCompliance accepts APAC codes (PIPA Korea, PDP Indonesia)', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    for (const j of ['PIPA', 'PDP'] as const) {
      await c.checkCompliance({
        company: `Acme ${j}`,
        auditScope: 'full',
        framework: 'GDPR',
        jurisdiction: j,
        hasDPO: true,
      });
      expect(capturedBody.jurisdiction).toBe(j);
    }
  });

  it('checkCompliance accepts PDPL jurisdiction (resolves server-side to UAE)', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme UAE',
      auditScope: 'full',
      framework: 'GDPR',
      jurisdiction: 'PDPL',
      hasDPO: true,
    });
    expect(capturedBody.jurisdiction).toBe('PDPL');
  });

  it('checkCompliance passes booleans', async () => {
    let capturedBody: any = null;
    const fetchMock = makeFetchMock((_u, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ success: true, result: {} });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.checkCompliance({
      company: 'Acme',
      auditScope: 'full',
      framework: 'LGPD',
      hasDPO: true,
      hasPrivacyPolicy: true,
    });
    expect(capturedBody.hasDPO).toBe(true);
    expect(capturedBody.hasPrivacyPolicy).toBe(true);
  });

  it('auditMicarArt accepts in-memory vault', async () => {
    const fetchMock = makeFetchMock((_u, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      expect(body.vault).toBeDefined();
      return jsonResponse({ success: true, result: { overallScore: 100, modules: {}, missingControls: [] } });
    });
    const c = new MCPClient({ fetchImpl: fetchMock });
    await c.auditMicarArt({
      vault: { authority: 'x', reserveAmount: 1000n.toString() } as any,
    });
  });
});

describe('MCPClient — meta endpoints', () => {
  it('health calls /health', async () => {
    let capturedUrl = '';
    const fetchMock = makeFetchMock((url) => {
      capturedUrl = url;
      return jsonResponse({ status: 'ok' });
    });
    const c = new MCPClient({ endpoint: 'https://m.x', fetchImpl: fetchMock });
    await c.health();
    expect(capturedUrl).toBe('https://m.x/health');
  });

  it('listTools calls /tools', async () => {
    let capturedUrl = '';
    const fetchMock = makeFetchMock((url) => {
      capturedUrl = url;
      return jsonResponse({ tools: [{ name: 't1', description: 'd', inputSchema: {} }] });
    });
    const c = new MCPClient({ endpoint: 'https://m.x', fetchImpl: fetchMock });
    const tools = await c.listTools();
    expect(capturedUrl).toBe('https://m.x/tools');
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('t1');
  });
});
