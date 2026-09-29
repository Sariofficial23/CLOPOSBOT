import { describe, expect, it } from 'vitest';
import {
  CloposAuth,
  InMemoryTokenStore,
  isTokenExpiring,
  requestToken,
  validateTokenScope,
} from '../auth';
import { CloposAuthError, CloposUnexpectedResponseError } from '../errors';
import { CREDS, fakeJwt, json, scriptedFetch } from './helpers';

const API = 'https://integrations.clopos.com/open-api';

describe('requestToken', () => {
  it('POSTs documented body to /v2/auth and parses expires_at', async () => {
    const { fetch, calls } = scriptedFetch([
      () => json(200, { success: true, token: 'tok', token_type: 'Bearer', expires_in: 3600, expires_at: 1767852332 }),
    ]);
    const t = await requestToken(CREDS, { apiUrl: `${API}/`, fetch });
    expect(calls[0]!.url).toBe(`${API}/v2/auth`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      client_id: 'cid',
      client_secret: 'super-secret',
      brand: 'demo',
      integrator_id: 'int-1',
    });
    expect(t.token).toBe('tok');
    expect(t.expiresAt.toISOString()).toBe(new Date(1767852332 * 1000).toISOString());
  });

  it('falls back to expires_in', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const { fetch } = scriptedFetch([() => json(200, { success: true, token: 't', expires_in: 60 })]);
    const t = await requestToken(CREDS, { apiUrl: API, fetch, now: () => now });
    expect(t.expiresAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('maps 401 to CloposAuthError without leaking the secret', async () => {
    const { fetch } = scriptedFetch([() => json(401, { success: false, message: 'bad' })]);
    const err = await requestToken(CREDS, { apiUrl: API, fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(CloposAuthError);
    expect(String(err.message)).not.toContain('super-secret');
  });

  it('treats success:false as auth failure', async () => {
    const { fetch } = scriptedFetch([() => json(200, { success: false })]);
    await expect(requestToken(CREDS, { apiUrl: API, fetch })).rejects.toBeInstanceOf(CloposAuthError);
  });

  it('rejects responses without a token', async () => {
    const { fetch } = scriptedFetch([() => json(200, { success: true, expires_in: 60 })]);
    await expect(requestToken(CREDS, { apiUrl: API, fetch })).rejects.toBeInstanceOf(CloposUnexpectedResponseError);
  });

  it('rejects missing credentials before calling the API', async () => {
    const { fetch, calls } = scriptedFetch([]);
    await expect(requestToken({ ...CREDS, brand: '' }, { apiUrl: API, fetch })).rejects.toBeInstanceOf(CloposAuthError);
    expect(calls).toHaveLength(0);
  });
});

describe('CloposAuth', () => {
  it('caches the token and renews it before expiry', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const { fetch, calls } = scriptedFetch([
      () => json(200, { success: true, token: 'first', expires_in: 3600 }),
      () => json(200, { success: true, token: 'second', expires_in: 3600 }),
    ]);
    const auth = new CloposAuth(CREDS, new InMemoryTokenStore(), { apiUrl: API, fetch, now: () => now, refreshSkewSeconds: 60 });
    expect(await auth.getToken()).toBe('first');
    now = new Date('2026-01-01T00:30:00Z');
    expect(await auth.getToken()).toBe('first');
    expect(calls).toHaveLength(1);
    now = new Date('2026-01-01T00:59:30Z'); // inside the 60s skew window
    expect(await auth.getToken()).toBe('second');
    expect(calls).toHaveLength(2);
  });

  it('shares one in-flight authentication between concurrent callers', async () => {
    const { fetch, calls } = scriptedFetch([() => json(200, { success: true, token: 'x', expires_in: 3600 })]);
    const auth = new CloposAuth(CREDS, new InMemoryTokenStore(), { apiUrl: API, fetch });
    const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(tokens).toEqual(['x', 'x', 'x']);
    expect(calls).toHaveLength(1);
  });

  it('isTokenExpiring', () => {
    const t = { token: 't', tokenType: 'Bearer', expiresAt: new Date('2026-01-01T01:00:00Z') };
    expect(isTokenExpiring(t, new Date('2026-01-01T00:58:00Z'), 60)).toBe(false);
    expect(isTokenExpiring(t, new Date('2026-01-01T00:59:01Z'), 60)).toBe(true);
  });
});

describe('validateTokenScope', () => {
  it('accepts a token for the configured brand/venue', () => {
    const tok = fakeJwt({ brand: 'demo', venue_id: 3, integrator_id: 'int-1' });
    const r = validateTokenScope(tok, { brand: 'demo', integratorId: 'int-1', venueId: '3' });
    expect(r.ok).toBe(true);
    expect(r.claims).toEqual({ brand: 'demo', venueId: '3', integratorId: 'int-1' });
  });

  it('flags a token for another brand or venue', () => {
    const tok = fakeJwt({ brand: 'other', venue_id: 9 });
    const r = validateTokenScope(tok, { brand: 'demo', venueId: '3' });
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(2);
  });

  it('tolerates opaque tokens', () => {
    expect(validateTokenScope('opaque', { brand: 'demo' }).ok).toBe(true);
  });
});
