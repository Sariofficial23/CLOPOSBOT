import type { NormalizedReceipt, SalesReportData } from '@cpos/clopos';
import { describe, expect, it } from 'vitest';
import { aggregateSales, classifyPayment, summarizeInventory } from '../services/report.calc';
import { formatReportText } from '../services/report.format';
import type { FullReport } from '../services/report.service';

const TZ = 'Asia/Tashkent';
const range = { from: new Date('2026-09-28T19:00:00Z'), to: new Date('2026-09-30T19:00:00Z') }; // 29–30 Sep local

function receipt(id: string, total: number, closedAt: string, payments: [string, number][], cost: number | null = null, lines: NormalizedReceipt['lines'] = null): NormalizedReceipt {
  return { id, total, closedAt: new Date(closedAt), payments: payments.map(([name, amount]) => ({ id: null, name, amount })), cost, lines };
}

describe('classifyPayment', () => {
  it.each([
    ['Наличные', 'cash'],
    ['Cash', 'cash'],
    ['Nağd', 'cash'],
    ['Карта', 'card'],
    ['Uzcard', 'card'],
    ['HUMO', 'card'],
    ['Payme', 'other'],
    ['Click', 'other'],
  ])('%s → %s', (name, bucket) => expect(classifyPayment(name)).toBe(bucket));
});

describe('aggregateSales', () => {
  const data: SalesReportData = {
    source: 'real',
    costAvailable: true,
    linesAvailable: true,
    receipts: [
      receipt('1', 100_000, '2026-09-29T05:00:00Z', [['Наличные', 100_000]], 40_000, [{ productId: 'p1', name: 'Плов', quantity: 2, total: 100_000 }]),
      receipt('2', 250_000, '2026-09-29T18:59:00Z', [['Карта', 200_000], ['Наличные', 50_000]], 100_000, [
        { productId: 'p2', name: 'Шашлык', quantity: 5, total: 250_000 },
      ]),
      // 20:00 UTC on 29th = 01:00 on the 30th in Tashkent → next local day
      receipt('3', 50_000, '2026-09-29T20:00:00Z', [['Payme', 50_000]], 10_000, [{ productId: 'p1', name: 'Плов', quantity: 1, total: 50_000 }]),
    ],
  };

  it('computes totals, payment buckets and gross profit', () => {
    const s = aggregateSales(data, range, TZ);
    expect(s.sales).toBe(400_000);
    expect(s.orders).toBe(3);
    expect(s.averageCheck).toBe(133_333.33);
    expect(s.payments).toEqual({ cash: 150_000, card: 200_000, other: 50_000 });
    expect(s.cost).toBe(150_000);
    expect(s.grossProfit).toBe(250_000);
    expect(s.grossMargin).toBe(62.5);
  });

  it('groups by local day in the company timezone (including empty days)', () => {
    const s = aggregateSales(data, range, TZ);
    expect(s.salesByDay).toEqual([
      { date: '2026-09-29', sales: 350_000, orders: 2, cost: 140_000, profit: 210_000 },
      { date: '2026-09-30', sales: 50_000, orders: 1, cost: 10_000, profit: 40_000 },
    ]);
  });

  it('ranks top products', () => {
    const s = aggregateSales(data, range, TZ);
    expect(s.topProducts?.[0]).toEqual({ name: 'Шашлык', quantity: 5, total: 250_000 });
    expect(s.topProducts?.[1]).toEqual({ name: 'Плов', quantity: 3, total: 150_000 });
  });

  it('reports cost/profit as null when Clopos gives no cost', () => {
    const s = aggregateSales({ ...data, costAvailable: false, linesAvailable: false }, range, TZ);
    expect(s.cost).toBeNull();
    expect(s.grossProfit).toBeNull();
    expect(s.topProducts).toBeNull();
    expect(s.salesByDay[0]!.profit).toBeNull();
  });

  it('counts receipts without payment lines as "other"', () => {
    const s = aggregateSales({ ...data, receipts: [receipt('9', 70_000, '2026-09-29T06:00:00Z', [])] }, range, TZ);
    expect(s.payments.other).toBe(70_000);
    expect(s.paymentMethods[0]!.name).toBe('Не указано');
  });

  it('handles an empty period', () => {
    const s = aggregateSales({ ...data, receipts: [] }, range, TZ);
    expect(s).toMatchObject({ sales: 0, orders: 0, averageCheck: 0, grossMargin: null });
  });
});

describe('summarizeInventory', () => {
  it('sums quantity, value and lists low stock', () => {
    const inv = summarizeInventory([
      { productId: 'a', productName: 'A', storageId: 's', quantity: 10, unit: 'шт', cost: 1000 },
      { productId: 'b', productName: 'B', storageId: 's', quantity: 2, unit: 'шт', cost: 500 },
    ]);
    expect(inv).toEqual({ positions: 2, totalQuantity: 12, totalValue: 11_000, lowStock: [{ productName: 'B', quantity: 2 }] });
  });
});

describe('formatReportText', () => {
  it('matches the agreed Telegram layout', () => {
    const sales = aggregateSales(
      {
        source: 'real',
        costAvailable: true,
        linesAvailable: false,
        receipts: [
          receipt('1', 5_200_000, '2026-09-29T06:00:00Z', [['Наличные', 5_200_000]], 2_000_000),
          receipt('2', 4_850_000, '2026-09-29T07:00:00Z', [['Карта', 4_850_000]], 2_120_000),
          receipt('3', 2_400_000, '2026-09-29T08:00:00Z', [['Payme', 2_400_000]], 2_000_000),
        ],
      },
      range,
      TZ,
    );
    const report: FullReport = {
      range: { preset: 'today', label: 'за сегодня (29.09.2026)', from: '', to: '', timezone: TZ },
      source: 'real',
      sales,
      expenses: { incoming: 0, salary: 0, total: 0 },
      inventory: { available: false, reason: 'n/a' },
      warnings: [],
      generatedAt: '',
    };
    const text = formatReportText(report, 'сум');
    expect(text).toContain('📊 ОТЧЁТ ЗА СЕГОДНЯ');
    expect(text).toContain('Продажи: 12 450 000 сум');
    expect(text).toContain('Заказов: 3');
    expect(text).toContain('Наличные: 5 200 000');
    expect(text).toContain('Карта: 4 850 000');
    expect(text).toContain('Другие: 2 400 000');
    expect(text).toContain('Себестоимость: 6 120 000');
    expect(text).toContain('Валовая прибыль: 6 330 000');
    expect(text).not.toContain('ТЕСТОВЫЕ');
  });
});
