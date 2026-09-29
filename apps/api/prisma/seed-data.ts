/**
 * Seed / test fixture data. Used by `pnpm db:seed` and by the API tests.
 * Idempotent: running it twice doesn't duplicate anything.
 */
import { DEFAULT_SCHEDULES, periodFromDate, type Role } from '@cpos/shared';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export interface SeedOptions {
  companyName?: string;
  timezone?: string;
  adminEmail: string;
  adminPassword: string;
  adminTelegramId?: string | null;
  /** lower bcrypt cost for tests */
  bcryptRounds?: number;
  /** extra demo users (one per role) */
  demoUsers?: boolean;
  /** demo employees + salary record (default true) */
  demoData?: boolean;
  demoPassword?: string;
}

export const DEMO_EMPLOYEES = [
  { name: 'Aziz', position: 'Повар', baseSalary: 6_000_000 },
  { name: 'Madina', position: 'Официант', baseSalary: 4_500_000 },
  { name: 'Sardor', position: 'Бармен', baseSalary: 5_000_000 },
];

export const DEMO_USERS: { name: string; email: string; role: Role; telegramId: string }[] = [
  { name: 'Demo Admin', email: 'admin.demo@example.com', role: 'ADMIN', telegramId: '100000001' },
  { name: 'Demo Manager', email: 'manager.demo@example.com', role: 'MANAGER', telegramId: '100000002' },
  { name: 'Demo Accountant', email: 'accountant.demo@example.com', role: 'ACCOUNTANT', telegramId: '100000003' },
  { name: 'Demo Employee', email: 'employee.demo@example.com', role: 'EMPLOYEE', telegramId: '100000004' },
];

export async function seed(prisma: PrismaClient, opts: SeedOptions) {
  const rounds = opts.bcryptRounds ?? 12;
  const timezone = opts.timezone ?? 'Asia/Tashkent';
  const existingAdmin = await prisma.user.findUnique({ where: { email: opts.adminEmail } });
  const company =
    existingAdmin
      ? await prisma.company.findUniqueOrThrow({ where: { id: existingAdmin.companyId } })
      : await prisma.company.create({ data: { name: opts.companyName ?? 'Demo Restaurant', timezone, currency: 'сум' } });

  const admin = await prisma.user.upsert({
    where: { email: opts.adminEmail },
    create: {
      companyId: company.id,
      name: 'Super Admin',
      email: opts.adminEmail,
      passwordHash: await bcrypt.hash(opts.adminPassword, rounds),
      telegramId: opts.adminTelegramId ?? null,
      role: 'SUPER_ADMIN',
    },
    update: { role: 'SUPER_ADMIN', active: true, ...(opts.adminTelegramId ? { telegramId: opts.adminTelegramId } : {}) },
  });

  const users: Record<string, string> = { SUPER_ADMIN: admin.id };
  if (opts.demoUsers) {
    const hash = await bcrypt.hash(opts.demoPassword ?? 'DemoPassword123!', rounds);
    for (const u of DEMO_USERS) {
      const row = await prisma.user.upsert({
        where: { email: u.email },
        create: { companyId: company.id, name: u.name, email: u.email, role: u.role, telegramId: u.telegramId, passwordHash: hash },
        update: {},
      });
      users[u.role] = row.id;
    }
  }

  const employees = [];
  for (const e of opts.demoData === false ? [] : DEMO_EMPLOYEES) {
    const existing = await prisma.employee.findFirst({ where: { companyId: company.id, name: e.name } });
    employees.push(existing ?? (await prisma.employee.create({ data: { companyId: company.id, ...e } })));
  }

  const period = periodFromDate(new Date(), timezone);
  const first = employees[0];
  if (first) await prisma.salaryRecord.upsert({
    where: { employeeId_period: { employeeId: first.id, period } },
    create: {
      companyId: company.id,
      employeeId: first.id,
      period,
      baseSalary: 6_000_000,
      bonus: 500_000,
      penalty: 200_000,
      advance: 1_000_000,
      total: 5_300_000,
    },
    update: {},
  });

  for (const s of DEFAULT_SCHEDULES) {
    await prisma.reportSchedule.upsert({
      where: { companyId_type: { companyId: company.id, type: s.type } },
      create: {
        companyId: company.id,
        type: s.type,
        enabled: false,
        hour: s.hour,
        minute: s.minute,
        dayOfWeek: s.dayOfWeek ?? null,
        dayOfMonth: s.dayOfMonth ?? null,
        reportPeriod: s.reportPeriod,
      },
      update: {},
    });
  }

  return { company, admin, users, employees, period };
}
