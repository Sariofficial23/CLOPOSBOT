import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, HAS_DB, type TestContext } from './helpers';

describe.skipIf(!HAS_DB)('scheduled reports worker', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await t.services.schedules.list(t.companyId);
    // enable daily 23:00 Tashkent (= 18:00 UTC); pretend it was configured long ago
    await t.prisma.reportSchedule.update({
      where: { companyId_type: { companyId: t.companyId, type: 'DAILY' } },
      data: { enabled: true, hour: 23, minute: 0, extraChatId: '-100123' },
    });
    await t.prisma.$executeRaw`UPDATE "ReportSchedule" SET "updatedAt" = '2026-01-01T00:00:00Z'`;
  });
  afterAll(async () => {
    await t?.app.close();
  });

  const at = new Date('2026-09-29T18:05:00Z'); // 23:05 Tashkent

  it('does nothing before the scheduled time', async () => {
    const sent: string[] = [];
    const r = await t.services.schedules.runDue(async (chat) => void sent.push(chat), new Date('2026-09-29T17:55:00Z'));
    // previous day's 23:00 is outside the 180 min lag window
    expect(r).toMatchObject({ due: 0, sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('sends to users with reports permission + extra chat', async () => {
    const sent: { chat: string; text: string }[] = [];
    const r = await t.services.schedules.runDue(async (chat, text) => void sent.push({ chat, text }), at);
    expect(r).toMatchObject({ due: 1, sent: 1, failed: 0 });
    const chats = sent.map((s) => s.chat).sort();
    // seed: SUPER_ADMIN 999000111, ADMIN/MANAGER/ACCOUNTANT demo users; EMPLOYEE excluded
    expect(chats).toEqual(['-100123', '100000001', '100000002', '100000003', '999000111'].sort());
    expect(sent[0]!.text).toContain('📊 ОТЧЁТ ЗА СЕГОДНЯ');
    expect(await t.prisma.auditLog.count({ where: { action: 'REPORT_SCHEDULED_SENT' } })).toBe(1);
  });

  it('is idempotent: a second (or concurrent) run does not resend', async () => {
    const sent: string[] = [];
    const [a, b] = await Promise.all([
      t.services.schedules.runDue(async (c) => void sent.push(c), new Date(at.getTime() + 60_000)),
      t.services.schedules.runDue(async (c) => void sent.push(c), new Date(at.getTime() + 60_000)),
    ]);
    expect(a.sent + b.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await t.prisma.reportDelivery.count()).toBe(1);
  });

  it('retries failed deliveries up to 3 attempts', async () => {
    const next = new Date('2026-09-30T18:05:00Z');
    const fail = async () => {
      throw new Error('telegram down');
    };
    expect((await t.services.schedules.runDue(fail, next)).failed).toBe(1);
    expect((await t.services.schedules.runDue(fail, new Date(next.getTime() + 60_000))).failed).toBe(1);
    const sent: string[] = [];
    expect((await t.services.schedules.runDue(async (c) => void sent.push(c), new Date(next.getTime() + 120_000))).sent).toBe(1);
    const d = await t.prisma.reportDelivery.findFirstOrThrow({ where: { occurrenceKey: 'DAILY:2026-09-30T23:00' } });
    expect(d).toMatchObject({ status: 'SENT', attempts: 3 });
    // a 4th run does nothing
    expect((await t.services.schedules.runDue(fail, new Date(next.getTime() + 180_000))).failed).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('telegram webhook secret verification', () => {
  let t: TestContext;
  const secret = 'webhook_secret_1234567890';
  beforeAll(async () => {
    t = await createTestContext({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_MODE: 'webhook', TELEGRAM_WEBHOOK_SECRET: secret });
    // rebuild with a bot whose handleUpdate is a spy
    await t.app.close();
    const { buildApp } = await import('../app');
    const handled: unknown[] = [];
    const bot = { handleUpdate: async (u: unknown) => void handled.push(u) } as never;
    t.app = await buildApp({ config: t.config, prisma: t.prisma, services: t.services, bot });
    (t as unknown as { handled: unknown[] }).handled = handled;
  });
  afterAll(async () => {
    await t?.app.close();
  });

  it('rejects requests without the secret header', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: { update_id: 1 } });
    expect(r.statusCode).toBe(401);
    const r2 = await t.app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: { update_id: 1 }, headers: { 'x-telegram-bot-api-secret-token': 'wrong' } });
    expect(r2.statusCode).toBe(401);
    expect((t as unknown as { handled: unknown[] }).handled).toHaveLength(0);
  });

  it('accepts the correct secret', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: { update_id: 7 }, headers: { 'x-telegram-bot-api-secret-token': secret } });
    expect(r.statusCode).toBe(200);
    expect((t as unknown as { handled: unknown[] }).handled).toEqual([{ update_id: 7 }]);
  });
});
