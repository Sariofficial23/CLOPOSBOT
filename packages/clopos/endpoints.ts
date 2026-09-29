/**
 * Registry of Clopos Open API endpoints used by this project.
 *
 * Source: official documentation https://developer.clopos.com (API v2).
 * Base URL (docs): https://integrations.clopos.com/open-api
 *
 * `verified: true`  — method + path taken verbatim from the documentation.
 * `verified: false` — the operation is listed in the documentation navigation
 *                     but the exact path was not confirmed; it follows the
 *                     documented v2 convention (/v2/<resource>). VERIFY before
 *                     production (see README → "Remaining TODOs").
 *
 * Operations with NO documented endpoint (storages/warehouses, suppliers,
 * stock balances, incoming/purchase operations) are deliberately absent.
 * The adapters throw CloposNotSupportedError for them instead of guessing.
 */
export interface EndpointDef {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  verified: boolean;
  doc: string;
}

export const CLOPOS_DEFAULT_API_URL = 'https://integrations.clopos.com/open-api';

export const ENDPOINTS = {
  auth: {
    method: 'POST',
    path: '/v2/auth',
    verified: true,
    doc: 'Authentication — body {client_id, client_secret, brand, integrator_id}; returns {token, expires_in, expires_at}',
  },
  listProducts: {
    method: 'GET',
    path: '/v2/products',
    verified: true,
    doc: 'Products → List Products (filters: type, category, tags, …)',
  },
  getReceipt: {
    method: 'GET',
    path: '/v2/receipts/{id}',
    verified: true,
    doc: 'Receipts → Get Receipt by ID (payment_methods, line items)',
  },
  listReceipts: {
    method: 'GET',
    path: '/v2/receipts',
    verified: false,
    doc: 'Receipts → List Receipts (listed in docs navigation; path per v2 convention)',
  },
  listCategories: {
    method: 'GET',
    path: '/v2/categories',
    verified: false,
    doc: 'Categories → List Categories (listed in docs navigation; path per v2 convention)',
  },
  listVenues: {
    method: 'GET',
    path: '/v2/venues',
    verified: false,
    doc: 'Venues → List Venues (listed in docs navigation; path per v2 convention)',
  },
} as const satisfies Record<string, EndpointDef>;

/**
 * TODO(clopos-verify): query parameter names for "List Receipts" (date filter
 * and pagination) were not available in the documentation excerpts we could
 * access. They are isolated here so they can be fixed in one place. The
 * RealCloposService ALSO filters receipts by date client-side, so a wrong
 * parameter name degrades performance, not correctness.
 */
export const RECEIPTS_LIST_QUERY = {
  page: 'page',
  limit: 'limit',
  dateFrom: 'date_from',
  dateTo: 'date_to',
  pageSize: 100,
  /** hard stop so a server that ignores pagination can't loop forever */
  maxPages: 200,
} as const;

/** Paths that were not confirmed against the docs; reported by the connection test. */
export function unverifiedEndpoints(): EndpointDef[] {
  return Object.values(ENDPOINTS).filter((e) => !e.verified);
}

/**
 * Operations the app needs for which Clopos documentation has no endpoint.
 * Surfaced in API/health output and the README so it's clear what to request
 * from Clopos (dev@clopos.com / your Clopos integration manager).
 */
export const MISSING_ENDPOINTS = {
  getStorages: 'GET list of storages/warehouses (id, name) for the brand/venue',
  getSuppliers: 'GET list of suppliers (id, name)',
  getStock: 'GET stock balances per product and storage (quantity, unit, cost)',
  createIncoming: 'POST create an incoming/purchase stock operation (storage, supplier, items[{product, quantity, price}])',
  getIncomingOperations: 'GET list of incoming/purchase stock operations with totals',
  receiptCost: 'Cost of goods sold per receipt in the receipts list (to compute gross profit without N+1 calls)',
} as const;
