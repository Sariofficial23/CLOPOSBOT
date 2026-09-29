/**
 * Parses a stock (остатки) report exported from Clopos as .xlsx or .csv.
 *
 * The exact export layout isn't documented, so columns are detected from the
 * header row by keyword (ru / uz / az / en). The header may sit below a title
 * block; we scan the first rows for it. Rows without a product name or a
 * numeric quantity (totals, section titles, blanks) are skipped.
 */
import ExcelJS from 'exceljs';

export type Column = 'name' | 'quantity' | 'storage' | 'unit' | 'cost' | 'value';

export interface ParsedStockRow {
  productName: string;
  storageName: string | null;
  quantity: number;
  unit: string | null;
  cost: number | null;
  value: number | null;
}

export interface ParsedStock {
  rows: ParsedStockRow[];
  columns: Partial<Record<Column, string>>;
  headerRow: number;
  sheetName: string | null;
  skipped: number;
  warnings: string[];
}

export class StockParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockParseError';
  }
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;

// Order matters: more specific keywords are checked first per column.
const KEYWORDS: Record<Column, string[]> = {
  quantity: ['остаток', 'остатки', 'количество', 'кол-во', 'кол.', 'qoldiq', 'miqdor', 'miqdar', 'qalıq', 'qaliq', 'quantity', 'qty', 'stock', 'balance'],
  cost: ['себестоимость', 'себест', 'цена', 'maya', 'narx', 'narxi', 'qiymət', 'qiymet', 'cost', 'price'],
  value: ['сумма', 'стоимость', 'итого', 'summa', 'jami', 'məbləğ', 'mebleg', 'amount', 'total', 'value'],
  storage: ['склад', 'ombor', 'anbar', 'warehouse', 'storage', 'store'],
  unit: ['ед. изм', 'ед.изм', 'единица', 'ед.', 'o‘lchov', "o'lchov", 'birlik', 'vahid', 'unit', 'uom'],
  name: ['наименование', 'название', 'товар', 'продукт', 'ингредиент', 'номенклатура', 'mahsulot', 'nomi', 'nomlanishi', 'məhsul', 'mehsul', 'adı', 'product', 'item', 'name'],
};

function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map header cells → column indexes. */
export function detectColumns(header: unknown[]): Map<Column, number> {
  const found = new Map<Column, number>();
  const taken = new Set<number>();
  const cells = header.map(norm);
  for (const col of ['quantity', 'cost', 'value', 'storage', 'unit', 'name'] as Column[]) {
    for (let i = 0; i < cells.length; i++) {
      if (taken.has(i) || !cells[i]) continue;
      if (KEYWORDS[col].some((k) => cells[i]!.includes(k))) {
        found.set(col, i);
        taken.add(i);
        break;
      }
    }
  }
  return found;
}

/** "1 234,50", "1,234.50", "12.5 кг", 7 → number; anything else → null. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return parseNumber((v as { result: unknown }).result); // Excel formula
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\s  ]/g, '').replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' ) return null;
  if (s.includes(',') && s.includes('.')) {
    // the last separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('richText' in o && Array.isArray(o.richText)) return o.richText.map((r) => (r as { text: string }).text).join('');
    if ('text' in o) return String(o.text);
    if ('result' in o) return String(o.result ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

// no \b: JS word boundaries don't work with Cyrillic
const TOTAL_ROW = /^(итого|всего|jami|cəmi|cemi|total|grand total)(?=$|[\s:.,])/i;

export function parseTable(table: unknown[][], sheetName: string | null = null): ParsedStock {
  let headerRow = -1;
  let cols = new Map<Column, number>();
  for (let r = 0; r < Math.min(table.length, 25); r++) {
    const c = detectColumns(table[r] ?? []);
    if (c.has('name') && c.has('quantity')) {
      headerRow = r;
      cols = c;
      break;
    }
  }
  if (headerRow < 0) {
    throw new StockParseError(
      'Не нашёл строку заголовков с колонками «Товар/Наименование» и «Остаток/Количество». Выгрузите отчёт по остаткам из Clopos в Excel без изменений.',
    );
  }
  const at = (row: unknown[], col: Column) => (cols.has(col) ? row[cols.get(col)!] : undefined);
  const rows: ParsedStockRow[] = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < table.length; r++) {
    const row = table[r] ?? [];
    const name = cellText(at(row, 'name')).trim();
    const quantity = parseNumber(at(row, 'quantity'));
    if (!name || quantity === null || TOTAL_ROW.test(name)) {
      if (row.some((c) => cellText(c).trim() !== '')) skipped++;
      continue;
    }
    if (rows.length >= MAX_ROWS) throw new StockParseError(`Слишком много строк (больше ${MAX_ROWS})`);
    const cost = parseNumber(at(row, 'cost'));
    const value = parseNumber(at(row, 'value'));
    rows.push({
      productName: name.slice(0, 255),
      storageName: cellText(at(row, 'storage')).trim().slice(0, 255) || null,
      quantity: Math.round(quantity * 1000) / 1000,
      unit: cellText(at(row, 'unit')).trim().slice(0, 32) || null,
      cost: cost === null ? null : Math.round(cost * 100) / 100,
      value: value !== null ? Math.round(value * 100) / 100 : cost !== null ? Math.round(cost * quantity * 100) / 100 : null,
    });
  }
  if (rows.length === 0) throw new StockParseError('В файле не найдено ни одной строки с товаром и количеством.');
  const header = table[headerRow] ?? [];
  const columns: Partial<Record<Column, string>> = {};
  for (const [col, idx] of cols) columns[col] = cellText(header[idx]).trim();
  const warnings: string[] = [];
  if (!cols.has('cost') && !cols.has('value')) warnings.push('Нет колонки себестоимости/суммы — стоимость остатков не посчитать');
  if (rows.some((r) => r.quantity < 0)) warnings.push('Есть отрицательные остатки');
  return { rows, columns, headerRow: headerRow + 1, sheetName, skipped, warnings };
}

/** Minimal RFC-4180 CSV parser; detects ; or , delimiter. */
export function parseCsv(text: string): unknown[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

export async function parseStockFile(buffer: Buffer, fileName: string): Promise<ParsedStock> {
  if (buffer.length > MAX_FILE_BYTES) throw new StockParseError('Файл больше 5 МБ');
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseTable(parseCsv(buffer.toString('utf8')));
  if (!lower.endsWith('.xlsx')) {
    throw new StockParseError(lower.endsWith('.xls') ? 'Старый формат .xls не поддерживается — сохраните файл как .xlsx' : 'Нужен файл .xlsx или .csv');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new StockParseError('Не удалось открыть Excel-файл (повреждён или защищён паролем)');
  }
  let lastError: unknown = null;
  for (const ws of wb.worksheets) {
    const table: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      table[n - 1] = values;
    });
    try {
      return parseTable(table, ws.name);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof StockParseError ? lastError : new StockParseError('В файле нет листов с остатками');
}
