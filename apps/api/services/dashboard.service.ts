import { localDateKey, periodFromDate, type ResolvedRange, round2 } from '@cpos/shared';
import type { PrismaClient } from '@prisma/client';
import { toNumber } from '../lib/prisma';
import type { CloposRegistry } from './clopos.service';
import type { ReportService } from './report.service';

export class DashboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reports: ReportService,
    private readonly clopos: CloposRegistry,
  ) {}

  async expensesByDay(companyId: string, range: ResolvedRange) {
    const [incomings, salaries] = await Promise.all([
      this.prisma.incoming.findMany({
        where: { companyId, createdAt: { gte: range.from, lt: range.to }, status: { in: ['SYNCED', 'LOCAL_ONLY'] } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.salaryRecord.findMany({
        where: { companyId, status: 'PAID', paidAt: { gte: range.from, lt: range.to } },
        select: { paidAt: true, total: true },
      }),
    ]);
    const days = new Map<string, { incoming: number; salary: number }>();
    for (const i of incomings) {
      const k = localDateKey(i.createdAt, range.timezone);
      const d = days.get(k) ?? { incoming: 0, salary: 0 };
      d.incoming += toNumber(i.total);
      days.set(k, d);
    }
    for (const s of salaries) {
      const k = localDateKey(s.paidAt as Date, range.timezone);
      const d = days.get(k) ?? { incoming: 0, salary: 0 };
      d.salary += toNumber(s.total);
      days.set(k, d);
    }
    return days;
  }

  async get(companyId: string, range: ResolvedRange) {
    const service = await this.clopos.forCompany(companyId);
    const [report, expenseDays, payroll] = await Promise.all([
      this.reports.build(companyId, range),
      this.expensesByDay(companyId, range),
      this.prisma.salaryRecord.aggregate({
        where: { companyId, period: periodFromDate(new Date(), range.timezone) },
        _sum: { total: true },
      }),
    ]);
    const s = report.sales;
    return {
      range: report.range,
      source: report.source,
      capabilities: service.capabilities,
      cards: {
        sales: s.sales,
        orders: s.orders,
        averageCheck: s.averageCheck,
        profit: s.grossProfit,
        stock: report.inventory.available
          ? { positions: report.inventory.summary.positions, value: report.inventory.summary.totalValue }
          : null,
        incoming: report.expenses.incoming,
        salaryPaid: report.expenses.salary,
        payrollCurrentMonth: toNumber(payroll._sum.total),
      },
      charts: {
        salesByDay: s.salesByDay,
        paymentMethods: s.paymentMethods,
        paymentBuckets: s.payments,
        topProducts: s.topProducts,
        expensesByDay: s.salesByDay.map((d) => {
          const e = expenseDays.get(d.date) ?? { incoming: 0, salary: 0 };
          return { date: d.date, incoming: round2(e.incoming), salary: round2(e.salary), total: round2(e.incoming + e.salary) };
        }),
        profitByDay: s.salesByDay.map((d) => ({ date: d.date, sales: d.sales, cost: d.cost, profit: d.profit })),
      },
      inventory: report.inventory,
      warnings: report.warnings,
    };
  }
}
