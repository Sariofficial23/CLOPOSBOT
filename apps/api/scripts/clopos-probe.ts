/**
 * Read-only check of the Clopos Open API with your credentials.
 * Verifies the endpoints marked `verified: false` in packages/clopos/endpoints.ts
 * and prints the response SHAPE (keys only) — never tokens, secrets or data values.
 *
 *   CLOPOS_BRAND=… pnpm --filter @cpos/api clopos:probe
 * (CLOPOS_CLIENT_ID / CLOPOS_CLIENT_SECRET / CLOPOS_INTEGRATOR_ID / CLOPOS_API_URL from .env)
 */
import { CLOPOS_DEFAULT_API_URL, ENDPOINTS, RECEIPTS_LIST_QUERY, decodeTokenClaims, joinUrl, requestToken } from '@cpos/clopos';

function shape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.length ? [`array(${value.length})`, shape(value[0], depth + 1)] : 'array(0)';
  if (value && typeof value === 'object') {
    if (depth > 2) return 'object';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof value;
}

async function main() {
  const apiUrl = process.env.CLOPOS_API_URL || CLOPOS_DEFAULT_API_URL;
  const creds = {
    clientId: process.env.CLOPOS_CLIENT_ID ?? '',
    clientSecret: process.env.CLOPOS_CLIENT_SECRET ?? '',
    brand: process.env.CLOPOS_BRAND ?? '',
    integratorId: process.env.CLOPOS_INTEGRATOR_ID ?? '',
  };
  console.log(`API: ${apiUrl}\nbrand: ${creds.brand}`);
  const token = await requestToken(creds, { apiUrl });
  console.log(`✅ POST ${ENDPOINTS.auth.path} — token expires ${token.expiresAt.toISOString()}`);
  const claims = decodeTokenClaims(token.token);
  if (claims) console.log('token claim keys:', Object.keys(claims).join(', '), '| brand:', claims.brand, '| venue_id:', claims.venue_id);

  const today = new Date();
  const dayAgo = new Date(today.getTime() - 86_400_000);
  const q = RECEIPTS_LIST_QUERY;
  const checks: [string, Record<string, string>][] = [
    [ENDPOINTS.listProducts.path, { [q.limit]: '2' }],
    [ENDPOINTS.listCategories.path, { [q.limit]: '2' }],
    [ENDPOINTS.listVenues.path, {}],
    [ENDPOINTS.listReceipts.path, { [q.page]: '1', [q.limit]: '2' }],
    [ENDPOINTS.listReceipts.path, { [q.page]: '1', [q.limit]: '2', [q.dateFrom]: dayAgo.toISOString(), [q.dateTo]: today.toISOString() }],
  ];
  for (const [path, query] of checks) {
    const url = new URL(joinUrl(apiUrl, path));
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { accept: 'application/json', 'x-token': token.token } });
    const body = await res.json().catch(() => null);
    console.log(`\n${res.ok ? '✅' : '❌'} GET ${path}?${[...url.searchParams.keys()].join('&')} → ${res.status}`);
    console.log(JSON.stringify(shape(body), null, 1).slice(0, 1500));
  }
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
