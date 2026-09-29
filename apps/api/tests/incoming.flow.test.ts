import { describe, expect, it } from 'vitest';
import {
  back,
  enterText,
  isComplete,
  selectOption,
  setPage,
  startIncoming,
  summaryText,
  toIncomingInput,
  visibleProducts,
} from '../bot/flows/incoming.flow';
import { parseNumberInput } from '../bot/flows/parse';
import { incomingKeyboard } from '../bot/keyboards';
import { incomingInputSchema } from '@cpos/shared';
import { incomingTotal } from '../services/incoming.service';

const storages = [{ id: 's1', name: 'Основной склад' }];
const suppliers = [{ id: 'u1', name: 'ABC Supplier' }];
const products = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: i === 3 ? 'Coca-Cola 0.5' : `Товар ${i}` }));

function completeFlow() {
  let s = startIncoming('flow-1', storages, suppliers, products);
  s = (selectOption(s, 'storage', 0) as { state: typeof s }).state;
  s = (selectOption(s, 'supplier', 0) as { state: typeof s }).state;
  s = (selectOption(s, 'product', 3) as { state: typeof s }).state;
  s = (enterText(s, '50') as { state: typeof s }).state;
  s = (enterText(s, '8 000') as { state: typeof s }).state;
  return s;
}

describe('parseNumberInput', () => {
  it.each([
    ['50', 50],
    ['12,5', 12.5],
    ['1 000', 1000],
    ['8000 сум', 8000],
    ['  3.25 ', 3.25],
  ])('%s → %s', (input, expected) => expect(parseNumberInput(input)).toBe(expected));

  it.each(['', 'abc', '-5', '1e5', '5,5,5', '12abc'])('rejects %s', (input) => expect(parseNumberInput(input)).toBeNull());
});

describe('incoming flow', () => {
  it('walks storage → supplier → product → quantity → price → confirm', () => {
    const s = completeFlow();
    expect(s.step).toBe('confirm');
    expect(isComplete(s)).toBe(true);
    expect(toIncomingInput(s)).toEqual({
      storageId: 's1',
      storageName: 'Основной склад',
      supplierId: 'u1',
      supplierName: 'ABC Supplier',
      items: [{ productId: 'p3', productName: 'Coca-Cola 0.5', quantity: 50, price: 8000 }],
    });
  });

  it('produces the agreed summary', () => {
    const text = summaryText(completeFlow(), 'сум');
    expect(text).toBe(
      ['📦 НОВЫЙ ПРИХОД', '', 'Поставщик:', 'ABC Supplier', 'Склад:', 'Основной склад', 'Товар:', 'Coca-Cola 0.5', 'Количество:', '50', 'Цена:', '8 000 сум', 'Итого:', '400 000 сум'].join('\n'),
    );
  });

  it('validates quantity and price', () => {
    let s = completeFlow();
    s = back(back(s)); // → quantity
    expect(s.step).toBe('quantity');
    expect(enterText(s, '0')).toMatchObject({ ok: false });
    expect(enterText(s, 'abc')).toMatchObject({ ok: false });
    expect(enterText(s, '99999999')).toMatchObject({ ok: false });
    expect(enterText(s, '1,0005')).toMatchObject({ ok: false });
    const q = enterText(s, '2,5');
    expect(q).toMatchObject({ ok: true });
    expect(enterText(q.state, '0')).toMatchObject({ ok: false });
    expect(enterText(q.state, '10,555')).toMatchObject({ ok: false });
  });

  it('rejects stale or out-of-range button presses', () => {
    const s = startIncoming('f', storages, suppliers, products);
    expect(selectOption(s, 'supplier', 0)).toMatchObject({ ok: false });
    expect(selectOption(s, 'storage', 5)).toMatchObject({ ok: false });
    expect(selectOption(s, 'storage', -1)).toMatchObject({ ok: false });
  });

  it('paginates and searches products', () => {
    let s = (selectOption((selectOption(startIncoming('f', storages, suppliers, products), 'storage', 0) as any).state, 'supplier', 0) as any).state;
    expect(visibleProducts(s)).toMatchObject({ page: 0, pages: 3 });
    s = setPage(s, 99);
    expect(visibleProducts(s).page).toBe(2);
    s = enterText(s, 'coca').state;
    const v = visibleProducts(s);
    expect(v.items).toHaveLength(1);
    expect(v.items[0]!.index).toBe(3);
  });

  it('keeps callback data within Telegram 64-byte limit', () => {
    const s = completeFlow();
    for (const step of [startIncoming('f', storages, suppliers, products), s]) {
      const kb = incomingKeyboard(step);
      for (const row of kb.reply_markup.inline_keyboard) for (const b of row) expect(Buffer.byteLength((b as { callback_data: string }).callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it('flow output passes the API schema', () => {
    expect(incomingInputSchema.safeParse(toIncomingInput(completeFlow())).success).toBe(true);
  });
});

describe('incoming validation (schema)', () => {
  const valid = {
    storageId: 's1',
    storageName: 'Склад',
    supplierId: 'u1',
    supplierName: 'ABC',
    items: [{ productId: 'p1', productName: 'Cola', quantity: 50, price: 8000 }],
  };
  it('accepts a valid payload and coerces numeric strings', () => {
    const r = incomingInputSchema.parse({ ...valid, items: [{ ...valid.items[0], quantity: '50', price: '8000.5' }] });
    expect(r.items[0]).toMatchObject({ quantity: 50, price: 8000.5 });
  });
  it.each([
    ['no items', { ...valid, items: [] }],
    ['zero quantity', { ...valid, items: [{ ...valid.items[0], quantity: 0 }] }],
    ['negative price', { ...valid, items: [{ ...valid.items[0], price: -1 }] }],
    ['3-decimal price', { ...valid, items: [{ ...valid.items[0], price: 1.234 }] }],
    ['missing storage', { ...valid, storageId: '' }],
  ])('rejects %s', (_n, payload) => expect(incomingInputSchema.safeParse(payload).success).toBe(false));

  it('total = Σ quantity × price', () => {
    expect(incomingTotal([{ quantity: 50, price: 8000 }, { quantity: 2.5, price: 1000.1 }])).toBe(402_500.25);
  });
});
