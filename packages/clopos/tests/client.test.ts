import { describe, expect, it } from 'vitest';
import { CloposAuth, InMemoryTokenStore } from '../auth';
import { CloposClient } from '../client';
import { CloposHttpError, CloposNotSupportedError } from '../errors';
import * as inventory from '../inventory';
import { RealCloposService } from '../real';
import { listReceipts, normalizeReceipt } from '../sales';
import { CREDS, json, scriptedFetch } from './helpers';

const API = 'https://integrations.clopos.com/open-api';
const authOk = () => json(200, { success: true, token: 'tok-1', expires_in: 3600 });

function makeClient(responders: Parameters<typeof scriptedFetch>[0]) {
  const s = scriptedFetch(responders);
  const auth = new CloposAuth(CREDS, new InMemoryTokenStore(), { apiUrl: API, fetch: s.fetch });
  const client = new CloposClient({ apiUrl: API, auth, fetch: s.fetch, sleep: async () => {} });
  return { client, calls: s.calls };
}

describe('CloposClient', () => {
  it('sends the token in the x-token header', async () => {
    const { client, calls } = makeClient([authOk, () => json(200, { data: [] })]);
    await client.get('/v2/products');
    const headers = calls[1]!.init?.headers as Record<string, string>;
    expect(calls[1]!.url).toBe(`${API}/v2/products`);
    expect(headers['x-token']).toBe('tok-1');
  });

  it('re-authenticates once on 401', async () => {
    const { client, calls } = makeClient([
      authOk,
      () => json(401, { message: 'expired' }),
      () => json(200, { success: true, token: 'tok-2', expires_in: 3600 }),
      () => json(200, []),
    ]);
    await client.get('/v2/products');
    expect((calls[3]!.init?.headers as Record<string, string>)['x-token']).toBe('tok-2');
  });

  it('retries GET on 5xx then succeeds', async () => {
    const { client, calls } = makeClient([authOk, () => json(502, {}), () => json(200, [{ id: 1, name: 'A' }])]);
    const r = await client.get<unknown[]>('/v2/products');
    expect(r).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('throws CloposHttpError after retries are exhausted', async () => {
    const { client } = makeClient([authOk, () => json(500, {}), () => json(500, {}), () => json(500, { message: 'boom' })]);
    await expect(client.get('/v2/products')).rejects.toBeInstanceOf(CloposHttpError);
  });

  it('encodes path parameters', async () => {
    const { client, calls } = makeClient([authOk, () => json(200, { id: 'a/b' })]);
    await client.get('/v2/receipts/{id}', { pathParams: { id: 'a/b' } });
    expect(calls[1]!.url).toBe(`${API}/v2/receipts/a%2Fb`);
  });
});

describe('inventory adapter', () => {
  it('maps products from a {data:[…]} envelope', async () => {
    const { client } = makeClient([
      authOk,
      () => json(200, { data: [{ id: 7, name: 'Cola', category_id: 2, price: '12000', type: 'GOODS' }, { foo: 1 }] }),
    ]);
    expect(await inventory.getProducts(client)).toEqual([
      { id: '7', name: 'Cola', categoryId: '2', price: 12000, type: 'GOODS' },
    ]);
  });

  it('never invents endpoints for undocumented operations', async () => {
    const { client, calls } = makeClient([]);
    await expect(inventory.getStorages(client)).rejects.toBeInstanceOf(CloposNotSupportedError);
    await expect(inventory.getSuppliers(client)).rejects.toBeInstanceOf(CloposNotSupportedError);
    await expect(inventory.getStock(client)).rejects.toBeInstanceOf(CloposNotSupportedError);
    await expect(
      inventory.createIncoming(client, { storageId: 's', supplierId: 'x', items: [], externalRef: 'r' }),
    ).rejects.toBeInstanceOf(CloposNotSupportedError);
    expect(calls).toHaveLength(0);
  });

  it('RealCloposService advertises the missing capabilities', () => {
    const { client } = makeClient([]);
    const svc = new RealCloposService(client);
    expect(svc.capabilities.createIncoming).toBe(false);
    expect(svc.capabilities.products).toBe(true);
  });
});

describe('receipts', () => {
  const base = {
    id: 1,
    total: '150000',
    closed_at: '2026-09-29 10:00:00',
    deleted_at: null,
    payment_methods: [
      { id: 1, name: 'Cash', amount: 100000 },
      { id: 2, name: 'Card', amount: '50000' },
    ],
  };

  it('normalizes documented fields', () => {
    const r = normalizeReceipt(base)!;
    expect(r.total).toBe(150000);
    expect(r.closedAt.toISOString()).toBe('2026-09-29T10:00:00.000Z');
    expect(r.payments).toEqual([
      { id: '1', name: 'Cash', amount: 100000 },
      { id: '2', name: 'Card', amount: 50000 },
    ]);
    expect(r.lines).toBeNull();
    expect(r.cost).toBeNull();
  });

  it('skips open and deleted receipts', () => {
    expect(normalizeReceipt({ ...base, closed_at: null })).toBeNull();
    expect(normalizeReceipt({ ...base, deleted_at: '2026-09-29 11:00:00' })).toBeNull();
  });

  it('pages, dedupes and filters by range client-side', async () => {
    const page1 = [
      { ...base, id: 1 },
      { ...base, id: 2, closed_at: '2026-09-28 10:00:00' }, // outside range
    ];
    const { client, calls } = makeClient([authOk, () => json(200, { data: page1 })]);
    const out = await listReceipts(client, { from: new Date('2026-09-29T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') });
    expect(out.map((r) => r.id)).toEqual(['1']);
    expect(calls).toHaveLength(2); // short page -> stop
  });
});
