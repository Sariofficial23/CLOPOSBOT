import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../lib/bootstrap';
import { HAS_DB, resetDb, testPrisma } from './helpers';

const log = { info: () => {}, warn: () => {} };

describe.skipIf(!HAS_DB)('bootstrapAdmin', () => {
  const db = HAS_DB ? testPrisma() : (null as never);
  beforeAll(async () => resetDb(db));
  afterAll(async () => resetDb(db));

  it('does nothing without env vars', async () => {
    expect(await bootstrapAdmin(db, {}, log)).toBe(false);
    expect(await db.user.count()).toBe(0);
  });

  it('creates company + SUPER_ADMIN on an empty database, without demo data', async () => {
    const env = { SEED_ADMIN_EMAIL: 'Owner@Firm.uz', SEED_ADMIN_PASSWORD: 'VeryStrong123', SEED_ADMIN_TELEGRAM_ID: '42', SEED_COMPANY_NAME: 'Plov House' };
    expect(await bootstrapAdmin(db, env, log)).toBe(true);
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'owner@firm.uz' }, include: { company: true } });
    expect(admin).toMatchObject({ role: 'SUPER_ADMIN', telegramId: '42' });
    expect(admin.company.name).toBe('Plov House');
    expect(await db.employee.count()).toBe(0);
    expect(await db.reportSchedule.count()).toBe(3);
  });

  it('never runs again once users exist', async () => {
    expect(await bootstrapAdmin(db, { SEED_ADMIN_EMAIL: 'x@y.z', SEED_ADMIN_PASSWORD: 'Another123' }, log)).toBe(false);
    expect(await db.user.count()).toBe(1);
  });
});
