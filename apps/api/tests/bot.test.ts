/**
 * Telegram handlers, end-to-end: real Telegraf + real services (test DB, mock
 * Clopos); only the Telegram HTTP API is replaced by a recorder.
 */
import { type Telegraf, Telegram } from 'telegraf';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BotContext } from '../bot/context';
import { createBot } from '../bot/index';
import { memorySessionStore } from '../bot/session-store';
import { createTestContext, HAS_DB, type TestContext } from './helpers';

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

const IDS = { SUPER_ADMIN: 999000111, MANAGER: 100000002, ACCOUNTANT: 100000003, EMPLOYEE: 100000004, STRANGER: 5555 };

describe.skipIf(!HAS_DB)('telegram bot handlers', () => {
  let t: TestContext;
  let bot: Telegraf<BotContext>;
  let calls: ApiCall[] = [];
  let updateId = 1;
  let originalCallApi: typeof Telegram.prototype.callApi;
  let stockFile = Buffer.from('');
  const store = memorySessionStore();

  beforeAll(async () => {
    t = await createTestContext();
    bot = createBot(
      '123:TEST',
      {
        resolveActor: (id) => t.services.auth.resolveTelegramActor(id),
        services: t.services,
        sessionStore: store,
        newId: () => `flow-${updateId}`,
        downloadFile: async () => stockFile,
      },
      { botInfo: { id: 123, is_bot: true, first_name: 'TestBot', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } },
    );
    // Telegraf creates a Telegram client per update, so patch the prototype:
    // record every Telegram API call instead of hitting the network
    originalCallApi = Telegram.prototype.callApi;
    (Telegram.prototype as unknown as { callApi: unknown }).callApi = async (method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      if (method === 'sendMessage' || method === 'editMessageText') {
        return { message_id: 1, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
      }
      return true;
    };
  });
  afterAll(async () => {
    Telegram.prototype.callApi = originalCallApi;
    await t?.app.close();
  });
  beforeEach(() => {
    calls = [];
  });

  const from = (id: number) => ({ id, is_bot: false, first_name: 'User' });
  const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'User' });

  async function text(userId: number, body: string) {
    const entities = body.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: body.split(' ')[0]!.length }] : undefined;
    await bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: chat(userId), from: from(userId), text: body, entities },
    } as never);
  }

  async function press(userId: number, data: string) {
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: String(updateId),
        from: from(userId),
        chat_instance: 'ci',
        data,
        message: { message_id: 1, date: 0, chat: chat(userId), text: 'prev', from: { id: 123, is_bot: true, first_name: 'TestBot' } },
      },
    } as never);
  }

  const texts = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => String(c.payload.text));
  const lastText = () => texts().at(-1) ?? '';
  const buttons = () => {
    const c = [...calls].reverse().find((x) => x.payload.reply_markup);
    const kb = (c?.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? [];
    return kb.flat();
  };

  it('denies unknown Telegram users and shows their ID', async () => {
    await text(IDS.STRANGER, '/start');
    expect(lastText()).toContain('Нет доступа');
    expect(lastText()).toContain(String(IDS.STRANGER));
    expect(await t.prisma.auditLog.count({ where: { action: 'AUTH_BOT_DENIED' } })).toBe(1);
  });

  it('/id works without an account', async () => {
    await text(IDS.STRANGER, '/id');
    expect(lastText()).toContain('5555');
  });

  it('ignores group chats', async () => {
    await bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: 1, date: 0, chat: { id: -100, type: 'group', title: 'g' }, from: from(IDS.SUPER_ADMIN), text: '/today' },
    } as never);
    expect(calls).toHaveLength(0);
  });

  it('main menu shows only permitted sections', async () => {
    await text(IDS.SUPER_ADMIN, '/start');
    expect(buttons().map((b) => b.text)).toEqual([
      '📊 Dashboard',
      '📦 Приход товара',
      '📈 Отчёты',
      '💰 Зарплата',
      '📦 Остатки',
      '💵 Продажи',
      '⚙️ Настройки',
    ]);
    await text(IDS.EMPLOYEE, '/menu');
    expect(buttons().map((b) => b.text)).toEqual(['📦 Приход товара', '📦 Остатки']);
  });

  it('/today sends the formatted report (and audits it)', async () => {
    await text(IDS.MANAGER, '/today');
    expect(lastText()).toContain('📊 ОТЧЁТ ЗА СЕГОДНЯ');
    expect(lastText()).toContain('Заказов:');
    expect(await t.prisma.auditLog.count({ where: { action: 'REPORT_GENERATE', userId: t.userIds.MANAGER } })).toBeGreaterThan(0);
  });

  it('enforces permissions on commands and buttons', async () => {
    await text(IDS.EMPLOYEE, '/month');
    expect(lastText()).toContain('Недостаточно прав');
    await press(IDS.MANAGER, 'm:sal');
    expect(calls.some((c) => c.method === 'answerCallbackQuery' && String(c.payload.text).includes('Недостаточно прав'))).toBe(true);
  });

  it('full /incoming flow: pick → validate → summary → confirm → saved + synced', async () => {
    await text(IDS.EMPLOYEE, '/incoming');
    expect(lastText()).toContain('Шаг 1/5');
    await press(IDS.EMPLOYEE, 'inc:s:0');
    expect(lastText()).toContain('Шаг 2/5');
    await press(IDS.EMPLOYEE, 'inc:u:0');
    await text(IDS.EMPLOYEE, 'coca');
    const cola = buttons().find((b) => b.text === 'Coca-Cola 0.5')!;
    await press(IDS.EMPLOYEE, cola.callback_data);
    expect(lastText()).toContain('Шаг 4/5');

    await text(IDS.EMPLOYEE, 'пятьдесят');
    expect(lastText()).toContain('⚠️');
    await text(IDS.EMPLOYEE, '50');
    await text(IDS.EMPLOYEE, '8 000');
    expect(lastText()).toContain('📦 НОВЫЙ ПРИХОД');
    expect(lastText()).toContain('Итого:\n400 000 сум');
    expect(buttons().map((b) => b.text)).toEqual(['✅ Подтвердить', '⬅️ Назад', '❌ Отмена']);

    await press(IDS.EMPLOYEE, 'inc:ok');
    expect(lastText()).toContain('✅ Приход отправлен в Clopos');
    const saved = await t.prisma.incoming.findFirstOrThrow({ where: { userId: t.userIds.EMPLOYEE }, include: { items: true } });
    expect(saved).toMatchObject({ status: 'SYNCED', source: 'telegram', supplierName: '[MOCK] ABC Supplier' });
    expect(saved.total.toNumber()).toBe(400_000);

    // double tap on the old confirm button does nothing
    await press(IDS.EMPLOYEE, 'inc:ok');
    expect(await t.prisma.incoming.count({ where: { userId: t.userIds.EMPLOYEE } })).toBe(1);
  });

  it('cancel clears the flow', async () => {
    await text(IDS.EMPLOYEE, '/incoming');
    await press(IDS.EMPLOYEE, 'x');
    expect(lastText()).toContain('Главное меню');
    await text(IDS.EMPLOYEE, '50');
    expect(lastText()).toContain('Главное меню'); // no active flow → menu
  });

  it('salary: add bonus with confirmation, then mark paid', async () => {
    const emp = t.employees.find((e) => e.name === 'Sardor')!;
    await press(IDS.ACCOUNTANT, 'm:sal');
    expect(lastText()).toContain('💰 ЗАРПЛАТА');
    expect(lastText()).toMatch(/\d\. Aziz/);

    await press(IDS.ACCOUNTANT, `sal:a:${emp.id}:bonus`);
    await text(IDS.ACCOUNTANT, '-5');
    expect(lastText()).toContain('⚠️');
    await text(IDS.ACCOUNTANT, '250000');
    expect(lastText()).toContain('Подтвердите: бонус 250 000 сум');
    await press(IDS.ACCOUNTANT, 'sal:ok');
    const rec = await t.prisma.salaryRecord.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(rec.bonus.toNumber()).toBe(250_000);
    expect(rec.total.toNumber()).toBe(5_250_000);

    await press(IDS.ACCOUNTANT, `sal:pay:${rec.id}`);
    expect(lastText()).toContain('Отметить выплату');
    await press(IDS.ACCOUNTANT, `sal:pok:${rec.id}`);
    expect((await t.prisma.salaryRecord.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('PAID');
    expect(await t.prisma.auditLog.count({ where: { entityId: rec.id, action: 'SALARY_PAY' } })).toBe(1);
  });

  it('adds an employee through the bot', async () => {
    await press(IDS.SUPER_ADMIN, 'emp:new');
    await text(IDS.SUPER_ADMIN, 'Bobur');
    await text(IDS.SUPER_ADMIN, 'Курьер');
    await text(IDS.SUPER_ADMIN, '3 500 000');
    expect(lastText()).toContain('Оклад: 3 500 000 сум');
    await press(IDS.SUPER_ADMIN, 'emp:ok');
    const e = await t.prisma.employee.findFirstOrThrow({ where: { name: 'Bobur' } });
    expect(e.baseSalary.toNumber()).toBe(3_500_000);
  });

  it('settings: toggling a schedule needs confirmation and is audited', async () => {
    await press(IDS.SUPER_ADMIN, 'm:set');
    expect(lastText()).toContain('⚙️ НАСТРОЙКИ');
    await press(IDS.SUPER_ADMIN, 'set:t:DAILY');
    expect(lastText()).toContain('Включить');
    await press(IDS.SUPER_ADMIN, 'set:ok:DAILY');
    const s = await t.prisma.reportSchedule.findFirstOrThrow({ where: { type: 'DAILY' } });
    expect(s.enabled).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { action: 'SCHEDULE_UPDATE' } })).toBe(1);
  });

  it('stock: Excel sent to the bot → preview → confirm → shown in 📦 Остатки and searchable', async () => {
    stockFile = Buffer.from('Товар;Склад;Остаток;Себестоимость\nCoca-Cola 0.5;Бар;50;8000\nМука;Кухня;2;9000\n');
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 99,
        date: 0,
        chat: chat(IDS.MANAGER),
        from: from(IDS.MANAGER),
        document: { file_id: 'f1', file_unique_id: 'u1', file_name: 'ostatki.csv', file_size: 100 },
      },
    } as never);
    expect(lastText()).toContain('📦 ИМПОРТ ОСТАТКОВ');
    expect(lastText()).toContain('Позиций: 2');
    const confirm = buttons().find((x) => x.text === '✅ Подтвердить')!;
    await press(IDS.MANAGER, confirm.callback_data);
    expect(lastText()).toContain('Остатки обновлены');

    await press(IDS.EMPLOYEE, 'm:stock');
    // mock adapter has its own stock; the import path is covered by the API test.
    expect(lastText()).toContain('📦 ОСТАТКИ');

    await press(IDS.MANAGER, 'stk:find');
    await text(IDS.MANAGER, 'мук');
    expect(lastText()).toContain('Мука (Кухня): 2');
  });

  it('stock import is refused for roles without catalog:manage', async () => {
    await bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: 100, date: 0, chat: chat(IDS.ACCOUNTANT), from: from(IDS.ACCOUNTANT), document: { file_id: 'f2', file_unique_id: 'u2', file_name: 'x.csv' } },
    } as never);
    expect(lastText()).toContain('Недостаточно прав');
  });

  it('errors are reported without internals', async () => {
    await press(IDS.ACCOUNTANT, 'sal:e:doesnotexist');
    expect(lastText()).toContain('⚠️ Employee not found');
  });
});
