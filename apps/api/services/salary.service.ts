/**
 * Employees and salary records.
 *   total = baseSalary + bonus - penalty - advance   (see @cpos/shared calculateSalaryTotal)
 * PAID records are immutable.
 */
import {
  calculateSalaryTotal,
  employeeCreateSchema,
  employeeUpdateSchema,
  round2,
  salaryAdjustSchema,
  salaryCreateSchema,
  salaryUpdateSchema,
} from '@cpos/shared';
import type { Employee, PrismaClient, SalaryRecord } from '@prisma/client';
import { AppError, Errors } from '../lib/errors';
import { toNumber } from '../lib/prisma';
import { AuditAction, type AuditService } from './audit.service';
import type { Actor } from './types';

export function serializeEmployee(e: Employee) {
  return {
    id: e.id,
    name: e.name,
    position: e.position,
    baseSalary: toNumber(e.baseSalary),
    active: e.active,
    telegramId: e.telegramId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeSalary(r: SalaryRecord & { employee?: Employee }) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee?.name ?? null,
    position: r.employee?.position ?? null,
    period: r.period,
    baseSalary: toNumber(r.baseSalary),
    bonus: toNumber(r.bonus),
    penalty: toNumber(r.penalty),
    advance: toNumber(r.advance),
    total: toNumber(r.total),
    status: r.status,
    paidAt: r.paidAt?.toISOString() ?? null,
    note: r.note,
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type SalaryDto = ReturnType<typeof serializeSalary>;

export class SalaryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- employees
  async listEmployees(companyId: string, opts: { activeOnly?: boolean } = {}) {
    const rows = await this.prisma.employee.findMany({
      where: { companyId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(serializeEmployee);
  }

  async getEmployee(companyId: string, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!e) throw Errors.notFound('Employee');
    return e;
  }

  async createEmployee(actor: Actor, raw: unknown) {
    const input = employeeCreateSchema.parse(raw);
    const e = await this.prisma.employee.create({
      data: { companyId: actor.companyId, ...input, telegramId: input.telegramId ?? null },
    });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.EMPLOYEE_CREATE,
      entity: 'Employee',
      entityId: e.id,
      metadata: { name: e.name, position: e.position, baseSalary: input.baseSalary },
      ip: actor.ip,
    });
    return serializeEmployee(e);
  }

  async updateEmployee(actor: Actor, id: string, raw: unknown) {
    const input = employeeUpdateSchema.parse(raw);
    const before = await this.getEmployee(actor.companyId, id);
    const e = await this.prisma.employee.update({ where: { id: before.id }, data: input });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      const from = key === 'baseSalary' ? toNumber(before.baseSalary) : before[key];
      changes[key] = { from, to: input[key] };
    }
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.EMPLOYEE_UPDATE,
      entity: 'Employee',
      entityId: id,
      metadata: { changes },
      ip: actor.ip,
    });
    return serializeEmployee(e);
  }

  // ------------------------------------------------------------------ salary
  private async getRecord(companyId: string, id: string) {
    const r = await this.prisma.salaryRecord.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!r) throw Errors.notFound('Salary record');
    return r;
  }

  private assertEditable(r: SalaryRecord) {
    if (r.status === 'PAID') throw new AppError(409, 'SALARY_ALREADY_PAID', 'Зарплата уже выплачена — изменения запрещены');
  }

  /** Create or recalculate the record for employee + period. */
  async calculate(actor: Actor, raw: unknown) {
    const input = salaryCreateSchema.parse(raw);
    const employee = await this.getEmployee(actor.companyId, input.employeeId);
    const existing = await this.prisma.salaryRecord.findUnique({
      where: { employeeId_period: { employeeId: employee.id, period: input.period } },
    });
    if (existing) this.assertEditable(existing);

    const components = {
      baseSalary: input.baseSalary ?? (existing ? toNumber(existing.baseSalary) : toNumber(employee.baseSalary)),
      bonus: input.bonus ?? toNumber(existing?.bonus),
      penalty: input.penalty ?? toNumber(existing?.penalty),
      advance: input.advance ?? toNumber(existing?.advance),
    };
    const total = calculateSalaryTotal(components);
    const record = await this.prisma.salaryRecord.upsert({
      where: { employeeId_period: { employeeId: employee.id, period: input.period } },
      create: { companyId: actor.companyId, employeeId: employee.id, period: input.period, ...components, total, note: input.note },
      update: { ...components, total, ...(input.note !== undefined ? { note: input.note } : {}) },
      include: { employee: true },
    });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.SALARY_CALCULATE,
      entity: 'SalaryRecord',
      entityId: record.id,
      metadata: { employee: employee.name, period: input.period, ...components, total, recalculated: !!existing },
      ip: actor.ip,
    });
    return serializeSalary(record);
  }

  /** Draft records for every active employee lacking one for the period. */
  async calculateAll(actor: Actor, period: string) {
    const employees = await this.prisma.employee.findMany({ where: { companyId: actor.companyId, active: true } });
    const existing = await this.prisma.salaryRecord.findMany({
      where: { companyId: actor.companyId, period },
      select: { employeeId: true },
    });
    const have = new Set(existing.map((e) => e.employeeId));
    let created = 0;
    for (const e of employees) {
      if (have.has(e.id)) continue;
      await this.calculate(actor, { employeeId: e.id, period });
      created++;
    }
    return { created, skipped: employees.length - created };
  }

  async update(actor: Actor, id: string, raw: unknown) {
    const input = salaryUpdateSchema.parse(raw);
    const r = await this.getRecord(actor.companyId, id);
    this.assertEditable(r);
    const components = {
      baseSalary: input.baseSalary ?? toNumber(r.baseSalary),
      bonus: input.bonus ?? toNumber(r.bonus),
      penalty: input.penalty ?? toNumber(r.penalty),
      advance: input.advance ?? toNumber(r.advance),
    };
    const total = calculateSalaryTotal(components);
    const res = await this.prisma.salaryRecord.updateMany({
      where: { id, updatedAt: r.updatedAt, status: 'DRAFT' },
      data: { ...components, total, ...(input.note !== undefined ? { note: input.note } : {}) },
    });
    if (res.count === 0) throw new AppError(409, 'CONCURRENT_UPDATE', 'Запись изменена другим пользователем, повторите');
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.SALARY_UPDATE,
      entity: 'SalaryRecord',
      entityId: id,
      metadata: {
        employee: r.employee.name,
        period: r.period,
        before: { baseSalary: toNumber(r.baseSalary), bonus: toNumber(r.bonus), penalty: toNumber(r.penalty), advance: toNumber(r.advance) },
        after: { ...components, total },
      },
      ip: actor.ip,
    });
    return serializeSalary(await this.getRecord(actor.companyId, id));
  }

  /** Add a bonus / penalty / advance amount on top of the current value. */
  async adjust(actor: Actor, id: string, raw: unknown) {
    const input = salaryAdjustSchema.parse(raw);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.getRecord(actor.companyId, id);
      this.assertEditable(r);
      const components = {
        baseSalary: toNumber(r.baseSalary),
        bonus: toNumber(r.bonus),
        penalty: toNumber(r.penalty),
        advance: toNumber(r.advance),
      };
      components[input.kind] = round2(components[input.kind] + input.amount);
      const total = calculateSalaryTotal(components);
      const res = await this.prisma.salaryRecord.updateMany({
        where: { id, updatedAt: r.updatedAt, status: 'DRAFT' },
        data: { [input.kind]: components[input.kind], total },
      });
      if (res.count === 0) continue; // concurrent change — re-read and retry
      await this.audit.log({
        companyId: actor.companyId,
        userId: actor.id,
        action: AuditAction.SALARY_ADJUST,
        entity: 'SalaryRecord',
        entityId: id,
        metadata: { employee: r.employee.name, period: r.period, kind: input.kind, amount: input.amount, note: input.note, total },
        ip: actor.ip,
      });
      return serializeSalary(await this.getRecord(actor.companyId, id));
    }
    throw new AppError(409, 'CONCURRENT_UPDATE', 'Не удалось сохранить из-за параллельных изменений, повторите');
  }

  async markPaid(actor: Actor, id: string) {
    const r = await this.getRecord(actor.companyId, id);
    this.assertEditable(r);
    const res = await this.prisma.salaryRecord.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'PAID', paidAt: new Date(), paidById: actor.id },
    });
    if (res.count === 0) throw new AppError(409, 'SALARY_ALREADY_PAID', 'Зарплата уже выплачена');
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.SALARY_PAY,
      entity: 'SalaryRecord',
      entityId: id,
      metadata: { employee: r.employee.name, period: r.period, total: toNumber(r.total) },
      ip: actor.ip,
    });
    return serializeSalary(await this.getRecord(actor.companyId, id));
  }

  async getForEmployee(companyId: string, employeeId: string, period: string) {
    const r = await this.prisma.salaryRecord.findFirst({ where: { companyId, employeeId, period }, include: { employee: true } });
    return r ? serializeSalary(r) : null;
  }

  async getById(companyId: string, id: string) {
    return serializeSalary(await this.getRecord(companyId, id));
  }

  /** Monthly payroll: every record for the period plus active employees without one. */
  async payroll(companyId: string, period: string) {
    const [records, employees] = await Promise.all([
      this.prisma.salaryRecord.findMany({
        where: { companyId, period },
        include: { employee: true },
        orderBy: { employee: { name: 'asc' } },
      }),
      this.prisma.employee.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
    ]);
    const withRecord = new Set(records.map((r) => r.employeeId));
    const items = records.map(serializeSalary);
    const sum = (k: 'baseSalary' | 'bonus' | 'penalty' | 'advance' | 'total') => round2(items.reduce((a, i) => a + i[k], 0));
    return {
      period,
      items,
      missing: employees.filter((e) => !withRecord.has(e.id)).map(serializeEmployee),
      totals: {
        baseSalary: sum('baseSalary'),
        bonus: sum('bonus'),
        penalty: sum('penalty'),
        advance: sum('advance'),
        total: sum('total'),
        paid: round2(items.filter((i) => i.status === 'PAID').reduce((a, i) => a + i.total, 0)),
        unpaid: round2(items.filter((i) => i.status !== 'PAID').reduce((a, i) => a + i.total, 0)),
      },
    };
  }
}
