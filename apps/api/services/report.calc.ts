/**
 * Pure report calculations (no I/O) — unit tested in tests/report.calc.test.ts.
 */
import type { NormalizedReceipt, SalesReportData, Stock } from '@cpos/clopos';
import { localDateKey, round2 } from '@cpos/shared';

export type PaymentBucket = 'cash' | 'card' | 'other';

const CASH = /нал|cash|nağd|naqd|нақд/i;
const CARD = /карт|card|kart|terminal|терминал|uzcard|humo|visa|master/i;

/** Classify a Clopos payment method name. Names are merchant-configured, so this is heuristic. */
export function classifyPayment(name: string): PaymentBucket {
  if (CASH.test(name)) return 'cash';
  if (CARD.test(name)) return 'card';
  return 'other';
}

export interface SalesSummary {
  sales: number;
  orders: number;
  averageCheck: number;
  payments: Record<PaymentBucket, number>;
  paymentMethods: { name: string; bucket: PaymentBucket; amount: number }[];
  /** null when the source doesn't provide cost of goods */
  cost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  salesByDay: { date: string; sales: number; orders: number; cost: number | null; profit: number | null }[];
  topProducts: { name: string; quantity: number; total: number }[] | null;
}

function eachDay(from: Date, to: Date, tz: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  // step in 6h increments so DST shifts can't skip a calendar day
  for (let t = from.getTime(); t < to.getTime(); t += 6 * 3_600_000) {
    const k = localDateKey(new Date(t), tz);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export function aggregateSales(
  data: SalesReportData,
  range: { from: Date; to: Date },
  timezone: string,
  topN = 10,
): SalesSummary {
  const receipts: NormalizedReceipt[] = data.receipts;
  const payments: Record<PaymentBucket, number> = { cash: 0, card: 0, other: 0 };
  const methods = new Map<string, number>();
  const days = new Map<string, { sales: number; orders: number; cost: number }>();
  for (const key of eachDay(range.from, range.to, timezone)) days.set(key, { sales: 0, orders: 0, cost: 0 });
  const products = new Map<string, { name: string; quantity: number; total: number }>();

  let sales = 0;
  let cost = 0;
  for (const r of receipts) {
    sales += r.total;
    cost += r.cost ?? 0;
    const paid = r.payments.reduce((a, p) => a + p.amount, 0);
    if (r.payments.length === 0 || paid === 0) {
      payments.other += r.total;
      methods.set('Не указано', (methods.get('Не указано') ?? 0) + r.total);
    } else {
      for (const p of r.payments) {
        payments[classifyPayment(p.name)] += p.amount;
        methods.set(p.name, (methods.get(p.name) ?? 0) + p.amount);
      }
    }
    const key = localDateKey(r.closedAt, timezone);
    const day = days.get(key) ?? { sales: 0, orders: 0, cost: 0 };
    day.sales += r.total;
    day.orders += 1;
    day.cost += r.cost ?? 0;
    days.set(key, day);
    for (const l of r.lines ?? []) {
      const k = l.productId ?? l.name;
      const agg = products.get(k) ?? { name: l.name, quantity: 0, total: 0 };
      agg.quantity += l.quantity;
      agg.total += l.total;
      products.set(k, agg);
    }
  }

  const orders = receipts.length;
  const costKnown = data.costAvailable;
  const totalCost = costKnown ? round2(cost) : null;
  const grossProfit = totalCost === null ? null : round2(sales - totalCost);
  return {
    sales: round2(sales),
    orders,
    averageCheck: orders ? round2(sales / orders) : 0,
    payments: { cash: round2(payments.cash), card: round2(payments.card), other: round2(payments.other) },
    paymentMethods: [...methods.entries()]
      .map(([name, amount]) => ({ name, bucket: classifyPayment(name), amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    cost: totalCost,
    grossProfit,
    grossMargin: grossProfit === null || sales === 0 ? null : round2((grossProfit / sales) * 100),
    salesByDay: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        sales: round2(d.sales),
        orders: d.orders,
        cost: costKnown ? round2(d.cost) : null,
        profit: costKnown ? round2(d.sales - d.cost) : null,
      })),
    topProducts: data.linesAvailable
      ? [...products.values()]
          .sort((a, b) => b.total - a.total)
          .slice(0, topN)
          .map((p) => ({ ...p, quantity: round2(p.quantity), total: round2(p.total) }))
      : null,
  };
}

export interface InventorySummary {
  positions: number;
  totalQuantity: number;
  /** null when no cost data */
  totalValue: number | null;
  lowStock: { productName: string; quantity: number }[];
}

export function summarizeInventory(stock: Stock[], lowStockThreshold = 5): InventorySummary {
  const withCost = stock.every((s) => s.cost !== null);
  return {
    positions: stock.length,
    totalQuantity: round2(stock.reduce((a, s) => a + s.quantity, 0)),
    totalValue: withCost ? round2(stock.reduce((a, s) => a + s.quantity * (s.cost ?? 0), 0)) : null,
    lowStock: stock
      .filter((s) => s.quantity <= lowStockThreshold)
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 20)
      .map((s) => ({ productName: s.productName, quantity: s.quantity })),
  };
}
