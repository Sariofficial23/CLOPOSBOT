import type { Role } from '@cpos/shared';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { type AppConfig, loadConfig } from '../config/env';
import { seed } from '../prisma/seed-data';
import { createServices, type Services } from '../services';

export const HAS_DB = !!process.env.TEST_DATABASE_URL;
export const ADMIN = { email: 'root@test.local', password: 'RootPassword123!' };
export const DEMO_PASSWORD = 'DemoPassword123!';
export const ROLES_ALL: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'];

let prisma: PrismaClient | null = null;
export function testPrisma(): PrismaClient {
  prisma ??= new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
  return prisma;
}

export async function resetDb(db: PrismaClient) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} CASCADE`);
  }
}

export interface TestContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  services: Services;
  config: AppConfig;
  companyId: string;
  tokens: Record<Role, string>;
  userIds: Record<Role, string>;
  employees: { id: string; name: string }[];
  period: string;
}

export async function createTestContext(env: Record<string, string> = {}, fetchImpl?: typeof fetch): Promise<TestContext> {
  const db = testPrisma();
  await resetDb(db);
  const config = loadConfig({ ...process.env, ...env });
  const seeded = await seed(db, {
    adminEmail: ADMIN.email,
    adminPassword: ADMIN.password,
    adminTelegramId: '999000111',
    demoUsers: true,
    demoPassword: DEMO_PASSWORD,
    bcryptRounds: 4,
  });
  const services = createServices(db, config, { error: () => {}, warn: () => {} }, { fetch: fetchImpl });
  const app = await buildApp({ config, prisma: db, services });
  await app.ready();
  const tokens = {} as Record<Role, string>;
  const userIds = seeded.users as Record<Role, string>;
  for (const role of ROLES_ALL) tokens[role] = app.signToken({ sub: userIds[role], cid: seeded.company.id, role });
  return {
    app,
    prisma: db,
    services,
    config,
    companyId: seeded.company.id,
    tokens,
    userIds,
    employees: seeded.employees.map((e) => ({ id: e.id, name: e.name })),
    period: seeded.period,
  };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}
