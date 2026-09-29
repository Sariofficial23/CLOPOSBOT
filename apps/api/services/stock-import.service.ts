/**
 * Stock snapshots imported from Clopos Excel/CSV exports.
 * Upload → DRAFT (preview) → confirm → ACTIVE. The latest ACTIVE import is the
 * current stock shown in the bot, dashboard and reports.
 */
import type { Stock } from '@cpos/clopos';
import { round2 } from '@cpos/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError, Errors } from '../lib/errors';
import { toNumber } from '../lib/prisma';
import { type ParsedStock, parseStockFile, StockParseError } from '../lib/stock-parser';
import { AuditAction, type AuditService } from './audit.service';
import type { Actor } from './types';

export class StockImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async parse(buffer: Buffer, fileName: string): Promise<ParsedStock> {
    try {
      return await parseStockFile(buffer, fileName);
    } catch (err) {
      if (err instanceof StockParseError) throw new AppError(400, 'STOCK_FILE_INVALID', err.message);
      throw err;
    }
  }

  async createDraft(actor: Actor, buffer: Buffer, fileName: string, source: 'telegram' | 'web') {
    const parsed = await this.parse(buffer, fileName);
    const totalQuantity = round2(parsed.rows.reduce((a, r) => a + r.quantity, 0));
    const withValue = parsed.rows.filter((r) => r.value !== null);
    const totalValue = withValue.length ? round2(withValue.reduce((a, r) => a + (r.value ?? 0), 0)) : null;
    // drop older unconfirmed drafts of this company
    await this.prisma.stockImport.deleteMany({ where: { companyId: actor.companyId, status: 'DRAFT' } });
    const draft = await this.prisma.stockImport.create({
      data: {
        companyId: actor.companyId,
        userId: actor.id,
        fileName: fileName.slice(0, 255),
        source,
        rowCount: parsed.rows.length,
        totalQuantity,
        totalValue,
        meta: { columns: parsed.columns, warnings: parsed.warnings, skipped: parsed.skipped, sheet: parsed.sheetName, headerRow: parsed.headerRow } as Prisma.InputJsonValue,
      },
    });
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await this.prisma.stockImportItem.createMany({
        data: parsed.rows.slice(i, i + 1000).map((r) => ({ importId: draft.id, ...r })),
      });
    }
    return {
      id: draft.id,
      fileName: draft.fileName,
      rowCount: parsed.rows.length,
      totalQuantity,
      totalValue,
      storages: [...new Set(parsed.rows.map((r) => r.storageName).filter(Boolean))] as string[],
      columns: parsed.columns,
      warnings: parsed.warnings,
      skipped: parsed.skipped,
      sample: parsed.rows.slice(0, 10),
    };
  }

  private async draftOf(companyId: string, id: string) {
    const d = await this.prisma.stockImport.findFirst({ where: { id, companyId } });
    if (!d) throw Errors.notFound('Stock import');
    return d;
  }

  async confirm(actor: Actor, id: string) {
    const d = await this.draftOf(actor.companyId, id);
    if (d.status === 'ACTIVE') throw Errors.conflict('ALREADY_CONFIRMED', 'Этот импорт уже подтверждён');
    await this.prisma.stockImport.update({ where: { id }, data: { status: 'ACTIVE', confirmedAt: new Date() } });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.STOCK_IMPORT,
      entity: 'StockImport',
      entityId: id,
      metadata: { fileName: d.fileName, rows: d.rowCount, totalValue: d.totalValue ? toNumber(d.totalValue) : null, source: d.source },
      ip: actor.ip,
    });
    return this.current(actor.companyId);
  }

  async discard(actor: Actor, id: string) {
    const d = await this.draftOf(actor.companyId, id);
    if (d.status !== 'DRAFT') throw Errors.badRequest('Подтверждённый импорт нельзя отменить');
    await this.prisma.stockImport.delete({ where: { id } });
  }

  private latestActive(companyId: string) {
    return this.prisma.stockImport.findFirst({
      where: { companyId, status: 'ACTIVE' },
      orderBy: { confirmedAt: 'desc' },
      include: { items: { orderBy: [{ storageName: 'asc' }, { productName: 'asc' }] } },
    });
  }

  /** Current imported stock, in the same shape the Clopos adapter uses. */
  async currentStock(companyId: string): Promise<{ asOf: string; fileName: string; stock: Stock[] } | null> {
    const imp = await this.latestActive(companyId);
    if (!imp) return null;
    return {
      asOf: (imp.confirmedAt ?? imp.createdAt).toISOString(),
      fileName: imp.fileName,
      stock: imp.items.map((i) => {
        const quantity = toNumber(i.quantity);
        const cost = i.cost !== null ? toNumber(i.cost) : i.value !== null && quantity ? round2(toNumber(i.value) / quantity) : null;
        return { productId: i.productName, productName: i.productName, storageId: i.storageName, quantity, unit: i.unit, cost };
      }),
    };
  }

  async current(companyId: string) {
    const c = await this.currentStock(companyId);
    return c ? { asOf: c.asOf, fileName: c.fileName, items: c.stock } : null;
  }

  async search(companyId: string, query: string, limit = 15) {
    const imp = await this.prisma.stockImport.findFirst({ where: { companyId, status: 'ACTIVE' }, orderBy: { confirmedAt: 'desc' } });
    if (!imp) return null;
    const items = await this.prisma.stockImportItem.findMany({
      where: { importId: imp.id, productName: { contains: query.trim(), mode: 'insensitive' } },
      orderBy: { productName: 'asc' },
      take: limit,
    });
    return {
      asOf: (imp.confirmedAt ?? imp.createdAt).toISOString(),
      items: items.map((i) => ({ productName: i.productName, storageName: i.storageName, quantity: toNumber(i.quantity), unit: i.unit })),
    };
  }
}
