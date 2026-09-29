/**
 * Inventory / catalogue operations against the real Clopos Open API.
 *
 * Implemented with documented endpoints:  getProducts, getCategories, getVenues
 * NOT documented by Clopos (throw CloposNotSupportedError, see MISSING_ENDPOINTS):
 *   getStorages, getSuppliers, getStock, createIncoming, getIncomingOperations
 */
import type { CloposClient } from './client';
import { ENDPOINTS, MISSING_ENDPOINTS } from './endpoints';
import { CloposNotSupportedError } from './errors';
import { extractList, num, str } from './normalize';
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

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.getStock */
export async function getStock(_client: CloposClient): Promise<Stock[]> {
  throw new CloposNotSupportedError('getStock', MISSING_ENDPOINTS.getStock);
}

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.createIncoming */
export async function createIncoming(_client: CloposClient, _input: IncomingInput): Promise<IncomingResult> {
  throw new CloposNotSupportedError('createIncoming', MISSING_ENDPOINTS.createIncoming);
}

/** TODO(clopos-endpoint): requires MISSING_ENDPOINTS.getIncomingOperations */
export async function getIncomingOperations(_client: CloposClient, _range?: DateRange): Promise<IncomingOperation[]> {
  throw new CloposNotSupportedError('getIncomingOperations', MISSING_ENDPOINTS.getIncomingOperations);
}
