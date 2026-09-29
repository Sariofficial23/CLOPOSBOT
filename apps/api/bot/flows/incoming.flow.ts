/**
 * /incoming — pure state machine (no Telegram / DB access; unit tested).
 *
 * storage → supplier → product → quantity → price → confirm
 */
import { formatAmount, formatMoney, type IncomingInputDto, round2 } from '@cpos/shared';
import { parseNumberInput } from './parse';

export interface Option {
  id: string;
  name: string;
}

export type IncomingStep = 'storage' | 'supplier' | 'product' | 'quantity' | 'price' | 'confirm';

export interface IncomingFlowState {
  kind: 'incoming';
  /** flow id — also the idempotency key for the final request */
  id: string;
  startedAt: number;
  step: IncomingStep;
  storages: Option[];
  suppliers: Option[];
  products: Option[];
  storage?: Option;
  supplier?: Option;
  product?: Option;
  quantity?: number;
  price?: number;
  page: number;
  filter?: string;
}

export type FlowResult = { ok: true; state: IncomingFlowState } | { ok: false; error: string; state: IncomingFlowState };

export const PRODUCTS_PER_PAGE = 8;
export const MAX_QUANTITY = 10_000_000;
export const MAX_PRICE = 9_999_999_999_999;

export function startIncoming(id: string, storages: Option[], suppliers: Option[], products: Option[], now = Date.now()): IncomingFlowState {
  return { kind: 'incoming', id, startedAt: now, step: 'storage', storages, suppliers, products, page: 0 };
}

export function visibleProducts(state: IncomingFlowState): { items: { option: Option; index: number }[]; page: number; pages: number } {
  const filter = state.filter?.toLowerCase();
  const all = state.products.map((option, index) => ({ option, index })).filter(({ option }) => !filter || option.name.toLowerCase().includes(filter));
  const pages = Math.max(1, Math.ceil(all.length / PRODUCTS_PER_PAGE));
  const page = Math.min(Math.max(0, state.page), pages - 1);
  return { items: all.slice(page * PRODUCTS_PER_PAGE, (page + 1) * PRODUCTS_PER_PAGE), page, pages };
}

export function selectOption(state: IncomingFlowState, list: 'storage' | 'supplier' | 'product', index: number): FlowResult {
  const expected: Record<typeof list, IncomingStep> = { storage: 'storage', supplier: 'supplier', product: 'product' };
  if (state.step !== expected[list]) return { ok: false, error: 'Этот шаг уже пройден', state };
  const source = list === 'storage' ? state.storages : list === 'supplier' ? state.suppliers : state.products;
  const option = Number.isInteger(index) ? source[index] : undefined;
  if (!option) return { ok: false, error: 'Вариант не найден, выберите снова', state };
  if (list === 'storage') return { ok: true, state: { ...state, storage: option, step: 'supplier' } };
  if (list === 'supplier') return { ok: true, state: { ...state, supplier: option, step: 'product', page: 0, filter: undefined } };
  return { ok: true, state: { ...state, product: option, step: 'quantity' } };
}

export function setPage(state: IncomingFlowState, page: number): IncomingFlowState {
  return { ...state, page: Math.max(0, Math.floor(page)) };
}

/** Free text: product search, quantity or price depending on the step. */
export function enterText(state: IncomingFlowState, text: string): FlowResult {
  const value = text.trim();
  switch (state.step) {
    case 'product': {
      if (value.length > 64) return { ok: false, error: 'Слишком длинный запрос', state };
      return { ok: true, state: { ...state, filter: value || undefined, page: 0 } };
    }
    case 'quantity': {
      const n = parseNumberInput(value);
      if (n === null) return { ok: false, error: 'Введите количество числом, например 50 или 12,5', state };
      if (n <= 0) return { ok: false, error: 'Количество должно быть больше 0', state };
      if (n > MAX_QUANTITY) return { ok: false, error: 'Слишком большое количество', state };
      if (Math.round(n * 1000) !== n * 1000) return { ok: false, error: 'Не более 3 знаков после запятой', state };
      return { ok: true, state: { ...state, quantity: n, step: 'price' } };
    }
    case 'price': {
      const n = parseNumberInput(value);
      if (n === null) return { ok: false, error: 'Введите цену числом, например 8000', state };
      if (n <= 0) return { ok: false, error: 'Цена должна быть больше 0', state };
      if (n > MAX_PRICE) return { ok: false, error: 'Слишком большая цена', state };
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: 'Не более 2 знаков после запятой', state };
      return { ok: true, state: { ...state, price: n, step: 'confirm' } };
    }
    default:
      return { ok: false, error: 'Используйте кнопки ниже', state };
  }
}

export function back(state: IncomingFlowState): IncomingFlowState {
  switch (state.step) {
    case 'supplier':
      return { ...state, step: 'storage', storage: undefined };
    case 'product':
      return { ...state, step: 'supplier', supplier: undefined, filter: undefined, page: 0 };
    case 'quantity':
      return { ...state, step: 'product', product: undefined };
    case 'price':
      return { ...state, step: 'quantity', quantity: undefined };
    case 'confirm':
      return { ...state, step: 'price', price: undefined };
    default:
      return state;
  }
}

export function flowTotal(state: IncomingFlowState): number {
  return round2((state.quantity ?? 0) * (state.price ?? 0));
}

export function isComplete(state: IncomingFlowState): boolean {
  return !!(state.storage && state.supplier && state.product && state.quantity && state.price && state.step === 'confirm');
}

export function toIncomingInput(state: IncomingFlowState): IncomingInputDto {
  if (!isComplete(state)) throw new Error('Incoming flow is not complete');
  return {
    storageId: state.storage!.id,
    storageName: state.storage!.name,
    supplierId: state.supplier!.id,
    supplierName: state.supplier!.name,
    items: [{ productId: state.product!.id, productName: state.product!.name, quantity: state.quantity!, price: state.price! }],
  };
}

export function summaryText(state: IncomingFlowState, currency: string): string {
  return [
    '📦 НОВЫЙ ПРИХОД',
    '',
    'Поставщик:',
    state.supplier?.name ?? '—',
    'Склад:',
    state.storage?.name ?? '—',
    'Товар:',
    state.product?.name ?? '—',
    'Количество:',
    state.quantity !== undefined ? formatAmount(state.quantity) : '—',
    'Цена:',
    state.price !== undefined ? formatMoney(state.price, currency) : '—',
    'Итого:',
    formatMoney(flowTotal(state), currency),
  ].join('\n');
}

export function stepPrompt(state: IncomingFlowState): string {
  const done: string[] = [];
  if (state.storage) done.push(`Склад: ${state.storage.name}`);
  if (state.supplier) done.push(`Поставщик: ${state.supplier.name}`);
  if (state.product) done.push(`Товар: ${state.product.name}`);
  if (state.quantity !== undefined) done.push(`Количество: ${formatAmount(state.quantity)}`);
  const head = ['📦 НОВЫЙ ПРИХОД', ...done, ''].join('\n');
  switch (state.step) {
    case 'storage':
      return `${head}Шаг 1/5. Выберите склад:`;
    case 'supplier':
      return `${head}Шаг 2/5. Выберите поставщика:`;
    case 'product': {
      const { page, pages, items } = visibleProducts(state);
      const filter = state.filter ? `Поиск: «${state.filter}»\n` : '';
      const empty = items.length === 0 ? 'Ничего не найдено.\n' : '';
      return `${head}Шаг 3/5. Выберите товар (стр. ${page + 1}/${pages}).\n${filter}${empty}Можно отправить часть названия для поиска.`;
    }
    case 'quantity':
      return `${head}Шаг 4/5. Введите количество (например 50):`;
    case 'price':
      return `${head}Шаг 5/5. Введите цену за единицу (например 8000):`;
    case 'confirm':
      return 'Проверьте данные:';
  }
}
