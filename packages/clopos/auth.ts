/**
 * Clopos authentication.
 *
 * Per the official docs (developer.clopos.com → Authentication, API v2), Clopos
 * issues each integration a client_id, client_secret, brand and integrator_id.
 * A token is obtained with:
 *
 *   POST {CLOPOS_API_URL}/v2/auth
 *   { "client_id", "client_secret", "brand", "integrator_id" }
 *   → { "success": true, "token": "<JWT>", "token_type": "Bearer",
 *       "expires_in": 3600, "expires_at": <unix seconds>, "message": "…" }
 *
 * and sent on every request in the `x-token` header. brand / venue_id /
 * integrator_id are encoded in the token (that is Clopos' notion of "scope").
 *
 * There is no documented refresh_token: "refresh" = re-authenticating with the
 * stored credentials shortly before `expires_at`, which this module does.
 *
 * TODO(clopos-verify): the docs describe OAuth 2.0 but we could not find a
 * documented browser authorization-code flow (authorize URL / redirect /
 * code exchange). CLOPOS_REDIRECT_URI is therefore reserved and the
 * /api/clopos/callback route answers 501 until Clopos confirms that flow.
 *
 * SECURITY: nothing in this module logs or includes tokens/secrets in errors.
 */
import { ENDPOINTS } from './endpoints';
import { CloposAuthError, CloposHttpError, CloposUnexpectedResponseError } from './errors';

export interface CloposCredentials {
  clientId: string;
  clientSecret: string;
  brand: string;
  integratorId: string;
}

export interface CloposToken {
  token: string;
  tokenType: string;
  expiresAt: Date;
}

/** Persists the current token (the API stores it encrypted in Postgres). */
export interface TokenStore {
  load(): Promise<CloposToken | null>;
  save(token: CloposToken): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private token: CloposToken | null = null;
  async load() {
    return this.token;
  }
  async save(token: CloposToken) {
    this.token = token;
  }
  async clear() {
    this.token = null;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthOptions {
  apiUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** renew this many seconds before expires_at */
  refreshSkewSeconds?: number;
  now?: () => Date;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function isTokenExpiring(token: CloposToken, now: Date, skewSeconds = 60): boolean {
  return token.expiresAt.getTime() - skewSeconds * 1000 <= now.getTime();
}

/** Exchange Clopos credentials for a token. */
export async function requestToken(creds: CloposCredentials, opts: AuthOptions): Promise<CloposToken> {
  for (const [k, v] of Object.entries(creds)) {
    if (!v || typeof v !== 'string') throw new CloposAuthError(`Missing Clopos credential: ${k}`);
  }
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await doFetch(joinUrl(opts.apiUrl, ENDPOINTS.auth.path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        brand: creds.brand,
        integrator_id: creds.integratorId,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network error';
    throw new CloposAuthError(`Clopos auth request failed (${reason})`);
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) {
    // include the status so a proxy/firewall 403 isn't mistaken for bad credentials
    throw new CloposAuthError(`Clopos rejected the credentials (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) throw new CloposHttpError(res.status, 'POST', ENDPOINTS.auth.path);
  if (obj.success === false) throw new CloposAuthError(`Clopos rejected the credentials (HTTP ${res.status})`, res.status);

  const token = obj.token;
  if (typeof token !== 'string' || token.length === 0) throw new CloposUnexpectedResponseError('auth: missing token');

  let expiresAt: Date;
  const expiresAtRaw = Number(obj.expires_at);
  const expiresInRaw = Number(obj.expires_in);
  if (Number.isFinite(expiresAtRaw) && expiresAtRaw > 0) {
    // docs: unix timestamp (seconds). Accept milliseconds defensively.
    expiresAt = new Date(expiresAtRaw > 1e12 ? expiresAtRaw : expiresAtRaw * 1000);
  } else if (Number.isFinite(expiresInRaw) && expiresInRaw > 0) {
    expiresAt = new Date(now().getTime() + expiresInRaw * 1000);
  } else {
    throw new CloposUnexpectedResponseError('auth: missing expires_at/expires_in');
  }
  const tokenType = typeof obj.token_type === 'string' ? obj.token_type : 'Bearer';
  return { token, tokenType, expiresAt };
}

/** Decode (NOT verify) the JWT payload. Informational only — Clopos verifies its own tokens. */
export function decodeTokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface ScopeExpectation {
  brand: string;
  integratorId?: string;
  venueId?: string;
}

export interface ScopeValidation {
  ok: boolean;
  problems: string[];
  /** safe, non-secret claims to show in the UI */
  claims: { brand?: string; venueId?: string; integratorId?: string };
}

/**
 * "Scope validation". Clopos does not document OAuth scope strings; a token is
 * scoped to brand + venue (+ integrator), encoded as claims. We check those
 * match what the company configured, so a token for another brand/venue is
 * never used.
 *
 * TODO(clopos-verify): claim names (brand / venue_id / integrator_id) follow
 * the docs' wording; if Clopos publishes explicit scopes, check them here.
 */
export function validateTokenScope(token: string, expected: ScopeExpectation): ScopeValidation {
  const claims = decodeTokenClaims(token);
  const problems: string[] = [];
  if (!claims) {
    // Opaque tokens are acceptable — we simply cannot introspect them.
    return { ok: true, problems, claims: {} };
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = claims[k];
      if (typeof v === 'string' || typeof v === 'number') return String(v);
    }
    return undefined;
  };
  const brand = pick('brand');
  const venueId = pick('venue_id', 'venueId');
  const integratorId = pick('integrator_id', 'integratorId');
  if (brand !== undefined && brand !== expected.brand) problems.push('Token brand does not match the configured brand');
  if (expected.integratorId && integratorId !== undefined && integratorId !== expected.integratorId) {
    problems.push('Token integrator_id does not match');
  }
  if (expected.venueId && venueId !== undefined && venueId !== expected.venueId) {
    problems.push('Token venue_id does not match the configured venue');
  }
  return { ok: problems.length === 0, problems, claims: { brand, venueId, integratorId } };
}

/**
 * Hands out a valid token, re-authenticating when it is about to expire.
 * Concurrent callers share a single in-flight authentication.
 */
export class CloposAuth {
  private inflight: Promise<CloposToken> | null = null;

  constructor(
    private readonly creds: CloposCredentials,
    private readonly store: TokenStore,
    private readonly opts: AuthOptions,
  ) {}

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  async getToken(): Promise<string> {
    const cached = await this.store.load();
    if (cached && !isTokenExpiring(cached, this.now(), this.opts.refreshSkewSeconds ?? 60)) return cached.token;
    return (await this.authenticate()).token;
  }

  /** Force a fresh token (e.g. after a 401). */
  authenticate(): Promise<CloposToken> {
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          const token = await requestToken(this.creds, this.opts);
          await this.store.save(token);
          return token;
        } finally {
          this.inflight = null;
        }
      })();
    }
    return this.inflight;
  }

  async invalidate(): Promise<void> {
    await this.store.clear();
  }

  get brand(): string {
    return this.creds.brand;
  }

  get integratorId(): string {
    return this.creds.integratorId;
  }
}
