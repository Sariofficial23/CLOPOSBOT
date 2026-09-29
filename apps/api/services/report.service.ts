/**
 * Report service: combines Clopos sales data with local data (incoming
 * purchases, paid salaries) into daily / weekly / monthly reports.
 *
 *  - sales, orders, payment methods          ← Clopos receipts
 *  - cost of goods / gross profit            ← Clopos (when available)
 *  - expenses (purchases + salary payouts)   ← local database
 *  - inventory summary                       ← Clopos stock (when available)
 */
import { CloposNotSupportedError, type SalesReportData } from '@cpos/clopos';
import { type ReportPreset, type ResolvedRange, resolveCustomRange, resolvePreset } from '@cpos/shared';
import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors';
import { toNumber } from '../lib/prisma';
import { AuditAction, type AuditService } from './audit.service';
import type { CloposRegistry } from './clopos.service';
import { aggregateSales, type InventorySummary, type SalesSummary, summarizeInventory } from './report.calc';
import { formatReportText } from './report.format';
import type { Actor } from './types';

export interface FullReport {
  range: { preset: ResolvedRange['preset']; label: string; from: string; to: string; timezone: string };
  source: 'real' | 'mock';
  sales: SalesSummary;
  expenses: { incoming: number; salary: number; total: number };
  inventory: { available: true; summary: InventorySummary } | { available: false; reason: string };
  warnings: string[];
  generatedAt: string;
}

/** Small TTL cache so dashboards and bots don't hammer Clopos. */
class TtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

export class ReportService {
  private readonly salesCache = new TtlCache<SalesReportData>(60_000);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly clopos: CloposRegistry,
    private readonly audit: AuditService,
  ) {}

  async companyTimezone(companyId: string): Promise<{ timezone: string; currency: string }> {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true, currency: true } });
    return c;
  }

  async resolveRange(companyId: string, q: { preset?: ReportPreset; from?: string; to?: string }, fallback: ReportPreset) {
    const { timezone } = await this.companyTimezone(companyId);
    if ((q.from && !q.to) || (!q.from && q.to)) throw Errors.badRequest('Укажите обе даты: from и to');
    try {
      if (q.from && q.to) return resolveCustomRange(q.from, q.to, timezone);
      return resolvePreset(q.preset ?? fallback, timezone);
    } catch (err) {
      if (err instanceof RangeError) throw Errors.badRequest(`Некорректный период: ${err.message}`);
      throw err;
    }
  }

  async salesData(companyId: string, range: { from: Date; to: Date }): Promise<SalesReportData> {
    const key = `${companyId}:${range.from.toISOString()}:${range.to.toISOString()}`;
    const cached = this.salesCache.get(key);
    if (cached) return cached;
    const service = await this.clopos.forCompany(companyId);
    const data = await service.getSalesReport(range);
    this.salesCache.set(key, data);
    return data;
  }

  async expenses(companyId: string, range: { from: Date; to: Date }) {
    const [incoming, salary] = await Promise.all([
      this.prisma.incoming.aggregate({
        where: { companyId, createdAt: { gte: range.from, lt: range.to }, status: { in: ['SYNCED', 'LOCAL_ONLY'] } },
        _sum: { total: true },
      }),
      this.prisma.salaryRecord.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: range.from, lt: range.to } },
        _sum: { total: true },
      }),
    ]);
    const inc = toNumber(incoming._sum.total);
    const sal = toNumber(salary._sum.total);
    return { incoming: inc, salary: sal, total: Math.round((inc + sal) * 100) / 100 };
  }

  async inventory(companyId: string): Promise<FullReport['inventory']> {
    const service = await this.clopos.forCompany(companyId);
    if (!service.capabilities.stock) {
      return { available: false, reason: 'Clopos Open API не предоставляет остатки (нужен endpoint остатков)' };
    }
    try {
      return { available: true, summary: summarizeInventory(await service.getStock()) };
    } catch (err) {
      if (err instanceof CloposNotSupportedError) return { available: false, reason: err.message };
      throw err;
    }
  }

  async build(companyId: string, range: ResolvedRange): Promise<FullReport> {
    const [data, expenses, inventory] = await Promise.all([
      this.salesData(companyId, range),
      this.expenses(companyId, range),
      this.inventory(companyId),
    ]);
    const warnings: string[] = [];
    if (!data.costAvailable) warnings.push('Себестоимость недоступна: Clopos не возвращает её в списке чеков.');
    return {
      range: { preset: range.preset, label: range.label, from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone },
      source: data.source,
      sales: aggregateSales(data, range, range.timezone),
      expenses,
      inventory,
      warnings,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Build + audit; used by API routes and bot commands. */
  async generate(actor: Actor, range: ResolvedRange, channel: 'api' | 'telegram' | 'schedule') {
    const report = await this.build(actor.companyId, range);
    await this.audit.log({
      companyId: actor.companyId,
      userId: channel === 'schedule' ? null : actor.id,
      action: AuditAction.REPORT_GENERATE,
      entity: 'Report',
      metadata: { preset: range.preset, from: report.range.from, to: report.range.to, channel },
      ip: actor.ip,
    });
    return report;
  }

  async generateText(actor: Actor, preset: ReportPreset, channel: 'api' | 'telegram' | 'schedule' = 'telegram') {
    const { timezone, currency } = await this.companyTimezone(actor.companyId);
    const report = await this.generate(actor, resolvePreset(preset, timezone), channel);
    return formatReportText(report, currency);
  }
}
