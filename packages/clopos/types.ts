/** Domain types used by the app. Adapters map Clopos payloads into these. */

export interface DateRange {
  /** inclusive */
  from: Date;
  /** exclusive */
  to: Date;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string | null;
  price: number | null;
  type: string | null;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Venue {
  id: string;
  name: string;
}

export interface Storage {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface Stock {
  productId: string;
  productName: string;
  storageId: string | null;
  quantity: number;
  unit: string | null;
  /** cost per unit, when the source provides it */
  cost: number | null;
}

export interface IncomingItemInput {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface IncomingInput {
  storageId: string;
  supplierId: string;
  note?: string;
  items: IncomingItemInput[];
  /** our local id, sent for idempotency where the API supports it */
  externalRef: string;
}

export interface IncomingResult {
  /** id of the operation in Clopos */
  id: string;
}

export interface IncomingOperation {
  id: string;
  storageId: string | null;
  supplierId: string | null;
  total: number;
  createdAt: Date;
}

export interface PaymentLine {
  id: string | null;
  name: string;
  amount: number;
}

export interface ReceiptLine {
  productId: string | null;
  name: string;
  quantity: number;
  total: number;
}

/** A closed sale, normalized from a Clopos receipt. */
export interface NormalizedReceipt {
  id: string;
  total: number;
  closedAt: Date;
  payments: PaymentLine[];
  /** present only when the source returns line items */
  lines: ReceiptLine[] | null;
  /** cost of goods sold for this receipt, when known */
  cost: number | null;
}

export interface SalesReportData {
  receipts: NormalizedReceipt[];
  /** true when every receipt carries a cost (COGS) */
  costAvailable: boolean;
  /** true when the source returned line items (top products) */
  linesAvailable: boolean;
  /** "real" or "mock" — surfaced in UI so mock data is never mistaken for real */
  source: 'real' | 'mock';
}

/** Which operations an adapter can actually perform. */
export interface CloposCapabilities {
  products: boolean;
  categories: boolean;
  venues: boolean;
  storages: boolean;
  suppliers: boolean;
  stock: boolean;
  createIncoming: boolean;
  incomingOperations: boolean;
  salesReport: boolean;
}
