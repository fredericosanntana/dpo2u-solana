/**
 * OAuth 2.0 PKCE Authorization Code flow (loopback redirect) for `dpo2u-cli login`.
 *
 * Fluxo (padrão GitHub CLI / Stripe CLI):
 *   1. CLI sobe server HTTP em porta aleatória 127.0.0.1:<port>/callback
 *   2. CLI faz DCR — POST /register no MCP — pra obter client_id
 *   3. CLI gera code_verifier + code_challenge (PKCE S256)
 *   4. Abre browser em /authorize?client_id=...&redirect_uri=loopback&code_challenge=...
 *   5. User faz login/OTP no browser → callback chega com `code`
 *   6. CLI troca code por access_token em POST /token (com code_verifier)
 *   7. Salva token em ~/.dpo2u/oauth.json
 *
 * Reutilizável pra qualquer integrador que queira implementar "login with DPO2U".
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL } from 'node:url';

export interface LoginOptions {
  /** Base URL do MCP server. Default: https://mcp.dpo2u.com */
  endpoint?: string;
  /** Nome do cliente (aparece no consent screen). Default: "dpo2u-cli". */
  clientName?: string;
  /** Diretório onde salvar o token. Default: ~/.dpo2u */
  tokenDir?: string;
  /** Função pra abrir o browser. Default: xdg-open/open/start conforme OS. */
  openBrowser?: (url: string) => Promise<void>;
  /** Callback chamado quando a URL está pronta (útil pra logar pro user). */
  onAuthUrl?: (url: string) => void;
  /** Porta específica pro loopback (default: aleatória). */
  port?: number;
  /** Timeout em ms pra esperar callback. Default: 5 min. */
  timeoutMs?: number;
}

export interface SavedToken {
  access_token: string;
  token_type: string;
  expires_at: number; // unix ms
  refresh_token?: string;
  scope?: string;
  endpoint: string;
  client_id: string;
  email?: string;
}

const DEFAULT_ENDPOINT = 'https://mcp.dpo2u.com';
const DEFAULT_CLIENT_NAME = 'dpo2u-cli';
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

export class OAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OAuthError';
  }
}

/** Base64url (no padding) from Buffer. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Default token dir: ~/.dpo2u (700) — avoids world-readable token storage. */
export function defaultTokenPath(): string {
  return join(homedir(), '.dpo2u', 'oauth.json');
}

export function saveToken(token: SavedToken, opts: { tokenDir?: string } = {}): string {
  const dir = opts.tokenDir ?? join(homedir(), '.dpo2u');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'oauth.json');
  writeFileSync(path, JSON.stringify(token, null, 2));
  try { chmodSync(path, 0o600); } catch { /* ignore — Windows */ }
  return path;
}

export function loadSavedToken(opts: { tokenDir?: string } = {}): SavedToken | null {
  const dir = opts.tokenDir ?? join(homedir(), '.dpo2u');
  const path = join(dir, 'oauth.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const token = JSON.parse(raw) as SavedToken;
    if (token.expires_at && Date.now() >= token.expires_at) {
      return null; // expired
    }
    return token;
  } catch {
    return null;
  }
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Fall through — user can open URL manually
  }
}

/**
 * Execute the full login flow. Returns the saved token on success, or throws.
 */
export async function login(opts: LoginOptions = {}): Promise<SavedToken> {
  const endpoint = (opts.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '');
  const clientName = opts.clientName ?? DEFAULT_CLIENT_NAME;
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  // 1. Spin up loopback server
  const { server, port, codePromise } = await startLoopbackServer(opts.port, timeoutMs);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    // 2. DCR — register this CLI instance as an OAuth client
    const clientInfo = await dcrRegister(endpoint, clientName, redirectUri);

    // 3. PKCE
    const { verifier, challenge } = generatePkce();
    const state = b64url(randomBytes(16));

    // 4. Build authorize URL + open browser
    const authUrl = new URL(endpoint + '/authorize');
    authUrl.searchParams.set('client_id', clientInfo.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'mcp:tools');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    const urlStr = authUrl.toString();

    if (opts.onAuthUrl) opts.onAuthUrl(urlStr);
    await openBrowser(urlStr);

    // 5. Wait for callback
    const { code, returnedState } = await codePromise;
    if (returnedState !== state) {
      throw new OAuthError('state mismatch — possible CSRF. Restart login.');
    }

    // 6. Exchange code for token
    const tokenResp = await tokenExchange(endpoint, {
      client_id: clientInfo.client_id,
      client_secret: clientInfo.client_secret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    // 7. Save
    const now = Date.now();
    const token: SavedToken = {
      access_token: tokenResp.access_token,
      token_type: tokenResp.token_type ?? 'Bearer',
      expires_at: now + (tokenResp.expires_in ?? 3600) * 1000,
      refresh_token: tokenResp.refresh_token,
      scope: tokenResp.scope,
      endpoint,
      client_id: clientInfo.client_id,
    };
    saveToken(token, { tokenDir: opts.tokenDir });
    return token;
  } finally {
    server.close();
  }
}

// ─── internals ──────────────────────────────────────────────────────────

interface LoopbackResult {
  server: Server;
  port: number;
  codePromise: Promise<{ code: string; returnedState: string }>;
}

function startLoopbackServer(portHint: number | undefined, timeoutMs: number): Promise<LoopbackResult> {
  return new Promise((resolveStart, rejectStart) => {
    let resolveCode!: (v: { code: string; returnedState: string }) => void;
    let rejectCode!: (e: Error) => void;
    const codePromise = new Promise<{ code: string; returnedState: string }>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1`);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state') ?? '';
      const err = url.searchParams.get('error');
      if (err) {
        const desc = url.searchParams.get('error_description') ?? '';
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html');
        res.end(successHtml(`<h2 style="color:#b00020">Authorization denied</h2><p>${err} — ${desc}</p>`));
        rejectCode(new OAuthError(`authorize denied: ${err} ${desc}`));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end('missing code');
        rejectCode(new OAuthError('callback without code'));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(successHtml('<h2 style="color:#14532d">Autorizado ✓</h2><p>Você pode fechar esta aba e voltar ao terminal.</p>'));
      resolveCode({ code, returnedState });
    });

    const timer = setTimeout(() => {
      rejectCode(new OAuthError(`timeout: no callback received in ${Math.round(timeoutMs / 1000)}s`));
      server.close();
    }, timeoutMs);
    codePromise.finally(() => clearTimeout(timer));

    server.on('error', rejectStart);
    server.listen(portHint ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        resolveStart({ server, port: addr.port, codePromise });
      } else {
        rejectStart(new OAuthError('failed to determine loopback port'));
      }
    });
  });
}

function successHtml(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>DPO2U</title>
  <style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:60px 20px;background:#f6f7f9;color:#111;text-align:center}.card{max-width:440px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.06)}</style>
  </head><body><div class="card">${content}</div></body></html>`;
}

async function dcrRegister(
  endpoint: string,
  clientName: string,
  redirectUri: string,
): Promise<{ client_id: string; client_secret?: string }> {
  const resp = await fetch(endpoint + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp:tools',
    }),
  });
  if (!resp.ok) {
    throw new OAuthError(`DCR register failed HTTP ${resp.status}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { client_id: string; client_secret?: string };
  return body;
}

async function tokenExchange(
  endpoint: string,
  args: {
    client_id: string;
    client_secret?: string;
    code: string;
    redirect_uri: string;
    code_verifier: string;
  },
): Promise<{
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', args.code);
  body.set('redirect_uri', args.redirect_uri);
  body.set('client_id', args.client_id);
  if (args.client_secret) body.set('client_secret', args.client_secret);
  body.set('code_verifier', args.code_verifier);

  const resp = await fetch(endpoint + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new OAuthError(`token exchange failed HTTP ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };
}
