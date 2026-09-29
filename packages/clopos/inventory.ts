/**
 * Inventory / catalogue operations against the real Clopos Open API.
 *
 * Implemented with documented endpoints:  getProducts, getCategories, getVenues
 * NOT documented by Clopos (throw CloposNotSupportedError, see MISSING_ENDPOINTS):
 *   getStorages, getSuppliers, getStock, createIncoming, getIncomingOperations
 */
import type { CloposClient } from './client';
import { ENDPOINTS, MISSING_ENDPOINTS, RECEIPTS_LIST_QUERY } from './endpoints';
import { CloposNotSupportedError } from './errors';
import { extractList, type Json, num, str } from './normalize';
import type {
  Category,
  DateRange,
  IncomingInput,
  IncomingOperation,
  IncomingResult,
  Product,
  Stock,
  Storage,
  Supplier,
  Venue,
} from './types';

export interface ProductFilters {
  type?: string;
  categoryId?: string;
}

/**
 * GET /v2/products (documented).
 * TODO(clopos-verify): filter parameter names and pagination; product field
 * names are mapped defensively (id, name|title, category_id, price, type).
 */
export async function getProducts(client: CloposClient, filters: ProductFilters = {}): Promise<Product[]> {
  const payload = await client.get(ENDPOINTS.listProducts.path, {
    query: { type: filters.type, category_id: filters.categoryId },
  });
  return extractList(payload, 'products')
    .map((p): Product | null => {
      const id = str(p.id);
      const name = str(p.name) ?? str(p.title);
      if (!id || !name) return null;
      return {
        id,
        name,
        categoryId: str(p.category_id),
        price: num(p.price),
        type: str(p.type),
      };
    })
    .filter((p): p is Product => p !== null);
}

/** GET /v2/categories — listed in the docs; path unverified (see endpoints.ts). */
export async function getCategories(client: CloposClient): Promise<Category[]> {
  const payload = await client.get(ENDPOINTS.listCategories.path);
  return extractList(payload, 'categories')
    .map((c): Category | null => {
      const id = str(c.id);
      const name = str(c.name) ?? str(c.title);
      if (!id || !name) return null;
      return { id, name, parentId: str(c.parent_id) };
    })
    .filter((c): c is Category => c !== null);
}

/** GET /v2/venues — listed in the docs; path unverified (see endpoints.ts). */
export async function getVenues(client: CloposClient): Promise<Venue[]> {
  const payload = await client.get(ENDPOINTS.listVenues.path);
  return extractList(payload, 'venues')
    .map((v): Venue | null => {
      const id = str(v.id);
      const name = str(v.name) ?? str(v.title);
      return id && name ? { id, name } : null;
    })
    .filter((v): v is Venue => v !== null);
}

// ---------------------------------------------------------------------------
// Operations with no documented Clopos endpoint. Do NOT add guessed paths here.
// When Clopos provides them: add to ENDPOINTS (verified: true), implement,
// flip the capability flag in RealCloposService.
// ---------------------------------------------------------------------------

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.getStorages */
export async function getStorages(_client: CloposClient): Promise<Storage[]> {
  throw new CloposNotSupportedError('getStorages', MISSING_ENDPOINTS.getStorages);
}

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.getSuppliers */
export async function getSuppliers(_client: CloposClient): Promise<Supplier[]> {
  throw new CloposNotSupportedError('getSuppliers', MISSING_ENDPOINTS.getSuppliers);
}

/**
 * Stock balances. Clopos confirmed a stock endpoint exists but it isn't in
 * the documentation we can access, so its path is configured by the operator
 * (CLOPOS_STOCK_PATH, as given by Clopos) — never guessed here. Without it the
 * operation stays unsupported.
 *
 * Field names are mapped defensively (product_id/name/title, storage/warehouse,
 * quantity/amount/balance/stock/count, unit, cost/cost_price/price).
 */
export async function getStock(client: CloposClient, stockPath?: string): Promise<Stock[]> {
  if (!stockPath) throw new CloposNotSupportedError('getStock', MISSING_ENDPOINTS.getStock);
  const q = RECEIPTS_LIST_QUERY;
  const seen = new Set<string>();
  const out: Stock[] = [];
  for (let page = 1; page <= q.maxPages; page++) {
    const payload = await client.get(stockPath, { query: { [q.page]: page, [q.limit]: q.pageSize } });
    const rows = extractList(payload, 'stock');
    let fresh = 0;
    for (const row of rows) {
      const item = normalizeStock(row);
      if (!item) continue;
      const key = `${item.storageId ?? ''}:${item.productId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh++;
      out.push(item);
    }
    if (rows.length < q.pageSize || fresh === 0) break;
  }
  return out;
}

function nested(o: Json, key: string): Json | null {
  const v = o[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

export function normalizeStock(r: Json): Stock | null {
  const product = nested(r, 'product') ?? nested(r, 'item') ?? nested(r, 'ingredient');
  const storage = nested(r, 'storage') ?? nested(r, 'warehouse') ?? nested(r, 'stock');
  const productName =
    str(r.product_name) ?? str(r.name) ?? str(r.title) ?? (product ? (str(product.name) ?? str(product.title)) : null);
  const productId = str(r.product_id) ?? str(r.item_id) ?? (product ? str(product.id) : null) ?? str(r.id) ?? productName;
  const quantity =
    num(r.quantity) ?? num(r.qty) ?? num(r.amount) ?? num(r.balance) ?? num(r.stock) ?? num(r.count) ?? num(r.remain) ?? num(r.remainder);
  if (!productId || !productName || quantity === null) return null;
  return {
    productId,
    productName,
    storageId: str(r.storage_id) ?? str(r.warehouse_id) ?? (storage ? (str(storage.name) ?? str(storage.id)) : null) ?? str(r.storage_name),
    quantity,
    unit: str(r.unit) ?? str(r.unit_name) ?? str(r.measure) ?? (product ? str(product.unit) : null),
    cost: num(r.cost) ?? num(r.cost_price) ?? num(r.avg_cost) ?? num(r.price) ?? (product ? num(product.cost) : null),
  };
}

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.createIncoming */
export async function createIncoming(_client: CloposClient, _input: IncomingInput): Promise<IncomingResult> {
  throw new CloposNotSupportedError('createIncoming', MISSING_ENDPOINTS.createIncoming);
}

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.getIncomingOperations */
export async function getIncomingOperations(_client: CloposClient, _range?: DateRange): Promise<IncomingOperation[]> {
  throw new CloposNotSupportedError('getIncomingOperations', MISSING_ENDPOINTS.getIncomingOperations);
}
