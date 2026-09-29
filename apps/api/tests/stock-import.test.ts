import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectColumns, parseCsv, parseNumber, parseStockFile, parseTable, StockParseError } from '../lib/stock-parser';
import { auth, createTestContext, HAS_DB, type TestContext } from './helpers';

async function xlsx(rows: unknown[][], sheet = 'Остатки'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('stock parser', () => {
  it('parses numbers in local formats', () => {
    expect(parseNumber('1 234,50')).toBe(1234.5);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('12,5 кг')).toBe(12.5);
    expect(parseNumber(7)).toBe(7);
    expect(parseNumber({ result: 3 })).toBe(3);
    expect(parseNumber('-2')).toBe(-2);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('detects columns in ru / uz / az / en', () => {
    expect([...detectColumns(['Наименование', 'Склад', 'Ед. изм.', 'Остаток', 'Себестоимость', 'Сумма']).entries()].sort()).toEqual(
      [['cost', 4], ['name', 0], ['quantity', 3], ['storage', 1], ['unit', 2], ['value', 5]].sort(),
    );
    expect(detectColumns(['Mahsulot nomi', 'Qoldiq']).get('quantity')).toBe(1);
    expect(detectColumns(['Məhsul', 'Anbar', 'Qalıq']).get('storage')).toBe(1);
    expect(detectColumns(['Product', 'Qty']).get('name')).toBe(0);
  });

  it('finds the header below a title block, skips totals and blanks', () => {
    const r = parseTable([
      ['Отчёт по остаткам'],
      ['Период: 29.09.2026'],
      [],
      ['№', 'Товар', 'Склад', 'Остаток', 'Ед.', 'Себестоимость'],
      [1, 'Coca-Cola 0.5', 'Бар', '50', 'шт', '8 000'],
      [2, 'Мука', 'Кухня', '12,5', 'кг', '9000'],
      ['', '', '', '', '', ''],
      ['', 'Итого', '', '62,5', '', ''],
    ]);
    expect(r.headerRow).toBe(4);
    expect(r.rows).toEqual([
      { productName: 'Coca-Cola 0.5', storageName: 'Бар', quantity: 50, unit: 'шт', cost: 8000, value: 400000 },
      { productName: 'Мука', storageName: 'Кухня', quantity: 12.5, unit: 'кг', cost: 9000, value: 112500 },
    ]);
    expect(r.skipped).toBe(1);
  });

  it('warns when there is no cost column', () => {
    const r = parseTable([['Товар', 'Количество'], ['Вода', 3]]);
    expect(r.warnings[0]).toMatch(/себестоимост/);
  });

  it('rejects files without a recognizable header', () => {
    expect(() => parseTable([['a', 'b'], [1, 2]])).toThrow(StockParseError);
  });

  it('parses CSV with ; delimiter and quotes', () => {
    const t = parseCsv('﻿Товар;Остаток\n"Сыр ""Российский""";"1,5"\nХлеб;10\n');
    expect(t).toEqual([['Товар', 'Остаток'], ['Сыр "Российский"', '1,5'], ['Хлеб', '10']]);
  });

  it('parses a real .xlsx file', async () => {
    const buf = await xlsx([['Mahsulot', 'Ombor', 'Qoldiq', 'Narx'], ['Pepsi', 'Asosiy', 24, 7000], ['Non', 'Asosiy', 3, 4000]]);
    const r = await parseStockFile(buf, 'qoldiq.xlsx');
    expect(r.sheetName).toBe('Остатки');
    expect(r.rows.map((x) => [x.productName, x.quantity, x.value])).toEqual([
      ['Pepsi', 24, 168000],
      ['Non', 3, 12000],
    ]);
  });

  it('rejects unsupported formats', async () => {
    await expect(parseStockFile(Buffer.from('x'), 'old.xls')).rejects.toThrow(/xlsx/);
    await expect(parseStockFile(Buffer.from('x'), 'photo.png')).rejects.toThrow(StockParseError);
    await expect(parseStockFile(Buffer.from('not a zip'), 'broken.xlsx')).rejects.toThrow(/Excel/);
  });
});

describe.skipIf(!HAS_DB)('stock import API', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext({ CLOPOS_ADAPTER: 'real', CLOPOS_CLIENT_SECRET: 'x', CLOPOS_CLIENT_ID: 'x', CLOPOS_INTEGRATOR_ID: 'x' });
    // real adapter needs a connection row; stock comes from imports only
    await t.prisma.cloposConnection.create({ data: { companyId: t.companyId, brand: 'b', clientId: 'x', integratorId: 'x', status: 'CONNECTED' } });
  });
  afterAll(async () => {
    await t?.app.close();
  });

  const post = (url: string, token: string, payload?: object) => t.app.inject({ method: 'POST', url, headers: auth(token), payload });

  it('upload → draft preview → confirm → current stock + inventory summary', async () => {
    const buf = await xlsx([['Товар', 'Склад', 'Остаток', 'Себестоимость'], ['Cola', 'Бар', 50, 8000], ['Мука', 'Кухня', 2, 9000]]);
    expect((await get('/api/stock')).json().data).toBeNull();
    const up = await post('/api/stock/import', t.tokens.MANAGER, { fileName: 'ostatki.xlsx', contentBase64: buf.toString('base64') });
    expect(up.statusCode).toBe(201);
    const draft = up.json().data;
    expect(draft).toMatchObject({ rowCount: 2, totalQuantity: 52, totalValue: 418000, storages: ['Бар', 'Кухня'] });
    // drafts are not visible yet
    expect((await get('/api/stock')).json().data).toBeNull();
    const ok = await post(`/api/stock/import/${draft.id}/confirm`, t.tokens.MANAGER);
    expect(ok.json().data.items).toHaveLength(2);
    const inv = (await get('/api/inventory')).json().data;
    expect(inv.summary).toMatchObject({ available: true, source: 'import', summary: { positions: 2, totalValue: 418000 } });
    expect(inv.summary.summary.lowStock).toEqual([{ productName: 'Мука', quantity: 2 }]);
    expect(await t.prisma.auditLog.count({ where: { action: 'STOCK_IMPORT' } })).toBe(1);
    expect((await post(`/api/stock/import/${draft.id}/confirm`, t.tokens.MANAGER)).statusCode).toBe(409);
  });

  it('bad files give a clear 400; permissions enforced', async () => {
    const bad = await post('/api/stock/import', t.tokens.ADMIN, { fileName: 'x.xlsx', contentBase64: Buffer.from('nope').toString('base64') });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('STOCK_FILE_INVALID');
    expect((await post('/api/stock/import', t.tokens.ACCOUNTANT, { fileName: 'a.csv', contentBase64: 'YQ==' })).statusCode).toBe(403);
    expect((await get('/api/stock', t.tokens.EMPLOYEE)).statusCode).toBe(200);
  });

  function get(url: string, token = t.tokens.ADMIN) {
    return t.app.inject({ method: 'GET', url, headers: auth(token) });
  }
});
