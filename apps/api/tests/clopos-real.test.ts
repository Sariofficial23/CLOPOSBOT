/**
 * RealCloposService end-to-end through the API, with Clopos replaced by a
 * scripted fetch that returns the documented response shapes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestContext, HAS_DB, type TestContext } from './helpers';

const API = 'https://integrations.clopos.com/open-api';
const SECRET = 'clopos-client-secret-value';
const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];

function jwt(payload: object) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig`;
}
const TOKEN = jwt({ brand: 'plovhouse', venue_id: 1, integrator_id: 'int-9' });

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url === `${API}/v2/auth`) {
    const body = JSON.parse(String(init?.body));
    if (body.client_secret !== SECRET) return json(401, { success: false, message: 'Invalid credentials' });
    return json(200, { success: true, token: TOKEN, token_type: 'Bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  }
  if (url.startsWith(`${API}/v2/products`)) return json(200, { data: [{ id: 1, name: 'Plov', price: 45000, category_id: 3 }] });
  if (url.startsWith(`${API}/v2/receipts`)) {
    const now = new Date();
    const closed = new Date(now.getTime() - 60_000).toISOString();
    return json(200, {
      data: [
        { id: 10, total: 100000, closed_at: closed, deleted_at: null, payment_methods: [{ id: 1, name: 'Наличные', amount: 100000 }] },
        { id: 11, total: 50000, closed_at: closed, deleted_at: null, payment_methods: [{ id: 2, name: 'Карта', amount: 50000 }] },
        { id: 12, total: 99999, closed_at: null, deleted_at: null, payment_methods: [] },
      ],
    });
  }
  return json(404, { message: 'not found' });
}) as typeof fetch;

describe.skipIf(!HAS_DB)('Clopos real adapter via API', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext({ CLOPOS_ADAPTER: 'real', CLOPOS_API_URL: API, CLOPOS_INTEGRATOR_ID: 'int-9' }, fakeFetch);
  });
  afterAll(async () => {
    await t?.app.close();
  });

  const post = (url: string, payload?: object) => t.app.inject({ method: 'POST', url, headers: auth(t.tokens.ADMIN), payload });
  const get = (url: string, token = t.tokens.ADMIN) => t.app.inject({ method: 'GET', url, headers: auth(token) });

  it('requires a connection before use', async () => {
    const r = await get('/api/sales');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('CLOPOS_NOT_CONNECTED');
  });

  it('rejects bad credentials without storing anything', async () => {
    const r = await post('/api/clopos/connect', { brand: 'plovhouse', clientId: 'cid', clientSecret: 'wrong' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('CLOPOS_AUTH_FAILED');
    expect(await t.prisma.cloposConnection.count()).toBe(0);
  });

  it('rejects a token for another brand (scope validation)', async () => {
    const r = await post('/api/clopos/connect', { brand: 'otherbrand', clientId: 'cid', clientSecret: SECRET });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('CLOPOS_SCOPE_MISMATCH');
  });

  it('connects: validates via POST /v2/auth and stores secrets encrypted', async () => {
    const r = await post('/api/clopos/connect', { brand: 'plovhouse', clientId: 'cid', clientSecret: SECRET });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toMatchObject({ mode: 'real', connected: true, brand: 'plovhouse', venueId: '1', usesEnvSecret: false });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const row = await t.prisma.cloposConnection.findUniqueOrThrow({ where: { companyId: t.companyId } });
    expect(row.clientSecretEnc).toMatch(/^v1\./);
    expect(row.clientSecretEnc).not.toContain(SECRET);
    expect(row.accessTokenEnc).not.toContain(TOKEN);

    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'CLOPOS_CONNECT' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it('builds sales from documented receipt fields, sending x-token', async () => {
    calls.length = 0;
    const r = await get('/api/sales?preset=today');
    expect(r.statusCode).toBe(200);
    const s = r.json().data.sales;
    expect(s).toMatchObject({ sales: 150_000, orders: 2, payments: { cash: 100_000, card: 50_000, other: 0 }, cost: null, grossProfit: null });
    const receiptsCall = calls.find((c) => c.url.includes('/v2/receipts'))!;
    expect(receiptsCall.headers['x-token']).toBe(TOKEN);
    expect(r.json().data.warnings[0]).toMatch(/Себестоимость/);
  });

  it('inventory: products work, stock reported as unsupported', async () => {
    const r = await get('/api/inventory');
    const d = r.json().data;
    expect(d.products).toEqual([{ id: '1', name: 'Plov', categoryId: '3', price: 45000, type: null }]);
    expect(d.stock).toBeNull();
    expect(d.summary.available).toBe(false);
    expect(d.capabilities).toMatchObject({ stock: false, createIncoming: false });
  });

  it('incoming options ask for local directories when Clopos has none', async () => {
    const r = await get('/api/incoming/options');
    expect(r.json().data).toMatchObject({ available: false, mode: 'real', sources: { storages: 'local', suppliers: 'local' } });
    expect(r.json().data.reason).toMatch(/Справочник/);
  });

  let warehouseId = '';
  let supplierId = '';
  it('local warehouses/suppliers make incoming available', async () => {
    warehouseId = (await post('/api/warehouses', { name: 'Основной склад' })).json().data.id;
    supplierId = (await post('/api/suppliers', { name: 'ABC Supplier', phone: '+998 90 123 45 67' })).json().data.id;
    expect((await post('/api/warehouses', { name: 'Основной склад' })).statusCode).toBe(409);
    const r = await get('/api/incoming/options');
    expect(r.json().data).toMatchObject({
      available: true,
      storages: [{ id: warehouseId, name: 'Основной склад' }],
      suppliers: [{ id: supplierId, name: 'ABC Supplier' }],
    });
    // inactive entries disappear from pickers
    await t.app.inject({ method: 'PATCH', url: `/api/suppliers/${supplierId}`, headers: auth(t.tokens.ADMIN), payload: { active: false } });
    expect((await get('/api/incoming/options')).json().data.available).toBe(false);
    await t.app.inject({ method: 'PATCH', url: `/api/suppliers/${supplierId}`, headers: auth(t.tokens.ADMIN), payload: { active: true } });
  });

  it('rejects incoming with an unknown warehouse', async () => {
    const r = await post('/api/incoming', {
      storageId: 'ghost',
      storageName: 'X',
      supplierId,
      supplierName: 'ABC',
      items: [{ productId: '1', productName: 'Plov', quantity: 1, price: 1 }],
    });
    expect(r.statusCode).toBe(400);
  });

  it('incoming is saved LOCAL_ONLY because Clopos has no documented endpoint', async () => {
    const r = await post('/api/incoming', {
      storageId: warehouseId,
      storageName: 'Основной склад',
      supplierId,
      supplierName: 'ABC Supplier',
      items: [{ productId: '1', productName: 'Plov', quantity: 2, price: 1000 }],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.incoming).toMatchObject({ status: 'LOCAL_ONLY', cloposOperationId: null });
    expect(r.json().data.incoming.syncError).toMatch(/does not document/);
  });

  it('connection test reports unverified endpoints', async () => {
    const r = await post('/api/clopos/test');
    const checks = r.json().data.checks;
    expect(checks.find((c: { name: string }) => c.name === 'auth').ok).toBe(true);
    expect(checks.find((c: { name: string }) => c.name === 'unverified-endpoints').detail).toMatch(/\/v2\/receipts/);
  });

  it('disconnect wipes stored secrets', async () => {
    await t.app.inject({ method: 'DELETE', url: '/api/clopos/connection', headers: auth(t.tokens.ADMIN) });
    const row = await t.prisma.cloposConnection.findUniqueOrThrow({ where: { companyId: t.companyId } });
    expect(row).toMatchObject({ status: 'DISCONNECTED', clientSecretEnc: null, accessTokenEnc: null });
  });
});
