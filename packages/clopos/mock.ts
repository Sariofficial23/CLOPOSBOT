/**
 * MockCloposService — DEVELOPMENT / TEST ONLY.
 *
 * Generates deterministic, obviously synthetic data so the bot and dashboard
 * can be developed without Clopos credentials. Every payload is tagged with
 * source: 'mock' and the UI shows a "MOCK DATA" badge. It never pretends to
 * be the real API, and the API server refuses to start with it in production.
 */
import { randomUUID } from 'node:crypto';
import type { ConnectionTestResult, CloposService } from './service';
import type {
  Category,
  CloposCapabilities,
  DateRange,
  IncomingInput,
  IncomingOperation,
  IncomingResult,
  NormalizedReceipt,
  Product,
  SalesReportData,
  Stock,
  Storage,
  Supplier,
  Venue,
} from './types';

const CATEGORIES: Category[] = [
  { id: 'mock-cat-1', name: '[MOCK] Напитки', parentId: null },
  { id: 'mock-cat-2', name: '[MOCK] Горячие блюда', parentId: null },
  { id: 'mock-cat-3', name: '[MOCK] Десерты', parentId: null },
];

const PRODUCTS: (Product & { cost: number })[] = [
  { id: 'mock-p-1', name: 'Coca-Cola 0.5', categoryId: 'mock-cat-1', price: 12_000, type: 'GOODS', cost: 8_000 },
  { id: 'mock-p-2', name: 'Fanta 0.5', categoryId: 'mock-cat-1', price: 12_000, type: 'GOODS', cost: 8_000 },
  { id: 'mock-p-3', name: 'Вода 1.0', categoryId: 'mock-cat-1', price: 6_000, type: 'GOODS', cost: 3_500 },
  { id: 'mock-p-4', name: 'Чай зелёный', categoryId: 'mock-cat-1', price: 8_000, type: 'DISH', cost: 1_500 },
  { id: 'mock-p-5', name: 'Плов', categoryId: 'mock-cat-2', price: 45_000, type: 'DISH', cost: 21_000 },
  { id: 'mock-p-6', name: 'Лагман', categoryId: 'mock-cat-2', price: 38_000, type: 'DISH', cost: 16_000 },
  { id: 'mock-p-7', name: 'Шашлык', categoryId: 'mock-cat-2', price: 32_000, type: 'DISH', cost: 17_000 },
  { id: 'mock-p-8', name: 'Самса', categoryId: 'mock-cat-2', price: 10_000, type: 'DISH', cost: 4_500 },
  { id: 'mock-p-9', name: 'Чизкейк', categoryId: 'mock-cat-3', price: 28_000, type: 'DISH', cost: 11_000 },
  { id: 'mock-p-10', name: 'Медовик', categoryId: 'mock-cat-3', price: 25_000, type: 'DISH', cost: 9_000 },
];

const STORAGES: Storage[] = [
  { id: 'mock-s-1', name: '[MOCK] Основной склад' },
  { id: 'mock-s-2', name: '[MOCK] Бар' },
  { id: 'mock-s-3', name: '[MOCK] Кухня' },
];

const SUPPLIERS: Supplier[] = [
  { id: 'mock-sup-1', name: '[MOCK] ABC Supplier' },
  { id: 'mock-sup-2', name: '[MOCK] Fresh Food' },
  { id: 'mock-sup-3', name: '[MOCK] Drinks Distribution' },
];

const PAYMENT_NAMES = ['Наличные', 'Карта', 'Payme', 'Click'];

/** small deterministic PRNG so the same day always yields the same numbers */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface MockOptions {
  now?: () => Date;
  /** set to simulate an outage */
  failWith?: Error;
}

export const MOCK_CAPABILITIES: Readonly<CloposCapabilities> = Object.freeze({
  products: true,
  categories: true,
  venues: true,
  storages: true,
  suppliers: true,
  stock: true,
  createIncoming: true,
  incomingOperations: true,
  salesReport: true,
});

export class MockCloposService implements CloposService {
  readonly mode = 'mock' as const;
  readonly capabilities: CloposCapabilities = { ...MOCK_CAPABILITIES };

  private readonly stock = new Map<string, number>();
  private readonly incoming: IncomingOperation[] = [];

  constructor(private readonly opts: MockOptions = {}) {
    PRODUCTS.forEach((p, i) => {
      for (const s of STORAGES) this.stock.set(`${s.id}:${p.id}`, 20 + ((i * 7) % 40));
    });
  }

  private guard() {
    if (this.opts.failWith) throw this.opts.failWith;
  }

  async getProducts(): Promise<Product[]> {
    this.guard();
    return PRODUCTS.map(({ cost: _c, ...p }) => ({ ...p }));
  }
  async getCategories() {
    this.guard();
    return CATEGORIES.map((c) => ({ ...c }));
  }
  async getVenues(): Promise<Venue[]> {
    this.guard();
    return [{ id: 'mock-venue-1', name: '[MOCK] Главный зал' }];
  }
  async getStorages() {
    this.guard();
    return STORAGES.map((s) => ({ ...s }));
  }
  async getSuppliers() {
    this.guard();
    return SUPPLIERS.map((s) => ({ ...s }));
  }

  async getStock(): Promise<Stock[]> {
    this.guard();
    const out: Stock[] = [];
    for (const s of STORAGES) {
      for (const p of PRODUCTS) {
        out.push({
          productId: p.id,
          productName: p.name,
          storageId: s.id,
          quantity: this.stock.get(`${s.id}:${p.id}`) ?? 0,
          unit: 'шт',
          cost: p.cost,
        });
      }
    }
    return out;
  }

  async createIncoming(data: IncomingInput): Promise<IncomingResult> {
    this.guard();
    if (!STORAGES.some((s) => s.id === data.storageId)) throw new Error('Unknown storage');
    if (!SUPPLIERS.some((s) => s.id === data.supplierId)) throw new Error('Unknown supplier');
    for (const item of data.items) {
      const key = `${data.storageId}:${item.productId}`;
      this.stock.set(key, (this.stock.get(key) ?? 0) + item.quantity);
    }
    const id = `mock-inc-${randomUUID()}`;
    this.incoming.push({
      id,
      storageId: data.storageId,
      supplierId: data.supplierId,
      total: data.items.reduce((a, i) => a + i.quantity * i.price, 0),
      createdAt: this.opts.now ? this.opts.now() : new Date(),
    });
    return { id };
  }

  async getIncomingOperations(range?: DateRange) {
    this.guard();
    return this.incoming.filter((o) => !range || (o.createdAt >= range.from && o.createdAt < range.to));
  }

  async getSalesReport(range: DateRange): Promise<SalesReportData> {
    this.guard();
    const now = this.opts.now ? this.opts.now() : new Date();
    const receipts: NormalizedReceipt[] = [];
    const dayMs = 86_400_000;
    const start = Math.floor(range.from.getTime() / dayMs) * dayMs;
    for (let day = start; day < range.to.getTime(); day += dayMs) {
      const dayKey = new Date(day).toISOString().slice(0, 10);
      const rnd = mulberry32(hash(dayKey));
      const count = 120 + Math.floor(rnd() * 90);
      for (let i = 0; i < count; i++) {
        // spread over 05:00–18:00 UTC (10:00–23:00 in UTC+5)
        const closedAt = new Date(day + 5 * 3_600_000 + Math.floor(rnd() * 13 * 3_600_000));
        const lineCount = 1 + Math.floor(rnd() * 4);
        const lines = [];
        let total = 0;
        let cost = 0;
        for (let l = 0; l < lineCount; l++) {
          const p = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)] ?? PRODUCTS[0]!;
          const qty = 1 + Math.floor(rnd() * 3);
          lines.push({ productId: p.id, name: p.name, quantity: qty, total: (p.price ?? 0) * qty });
          total += (p.price ?? 0) * qty;
          cost += p.cost * qty;
        }
        const payName = PAYMENT_NAMES[Math.floor(rnd() * PAYMENT_NAMES.length)] ?? 'Наличные';
        if (closedAt >= range.from && closedAt < range.to && closedAt <= now) {
          receipts.push({
            id: `mock-r-${dayKey}-${i}`,
            total,
            closedAt,
            payments: [{ id: null, name: payName, amount: total }],
            lines,
            cost,
          });
        }
      }
    }
    return { receipts, costAvailable: true, linesAvailable: true, source: 'mock' };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: !this.opts.failWith,
      mode: this.mode,
      checks: [{ name: 'mock', ok: !this.opts.failWith, detail: 'MockCloposService — synthetic data, not Clopos' }],
      capabilities: this.capabilities,
    };
  }
}
