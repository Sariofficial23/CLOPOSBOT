import { formatMoney, moneySchema, periodFromDate } from '@cpos/shared';
import { Markup, type Telegraf } from 'telegraf';
import type { BotContext, EmployeeCreateFlow, EmployeeEditFlow, SalaryInputFlow } from '../context';
import { parseNumberInput } from '../flows/parse';
import type { BotDeps } from '../index';
import { actorOf, allowed, show } from '../helpers';
import { backToMenu, CANCEL_ROW, confirmKeyboard } from '../keyboards';

const b = (t: string, d: string) => Markup.button.callback(t, d);
const FIELD_LABEL = { bonus: 'бонус', penalty: 'штраф', advance: 'аванс' } as const;
const STATUS_LABEL = { DRAFT: 'черновик', PAID: 'выплачено' } as const;

export function registerSalary(bot: Telegraf<BotContext>, deps: BotDeps) {
  const { salary, reports } = deps.services;

  const ctxInfo = async (ctx: BotContext) => {
    const actor = actorOf(ctx);
    const { timezone, currency } = await reports.companyTimezone(actor.companyId);
    return { actor, currency, period: periodFromDate(new Date(), timezone) };
  };

  const list = async (ctx: BotContext) => {
    if (!(await allowed(ctx, 'salary:view'))) return;
    const { actor, currency, period } = await ctxInfo(ctx);
    const payroll = await salary.payroll(actor.companyId, period);
    const employees = await salary.listEmployees(actor.companyId, { activeOnly: true });
    const byEmployee = new Map(payroll.items.map((i) => [i.employeeId, i]));
    const lines = ['💰 ЗАРПЛАТА', `Период: ${period}`, '', 'Сотрудники'];
    employees.forEach((e, i) => {
      const r = byEmployee.get(e.id);
      lines.push(`${i + 1}. ${e.name}${r ? ` — ${formatMoney(r.total, currency)} (${STATUS_LABEL[r.status]})` : ' — не рассчитано'}`);
    });
    if (!employees.length) lines.push('Нет активных сотрудников');
    const rows: ReturnType<typeof b>[][] = employees.slice(0, 40).map((e, i) => [b(`${i + 1}. ${e.name}`, `sal:e:${e.id}`)]);
    rows.push([b('📋 Ведомость', 'sal:roll'), b('🧮 Рассчитать всех', 'sal:all')]);
    rows.push([b('➕ Добавить сотрудника', 'emp:new')]);
    rows.push(backToMenu());
    await show(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  };

  const card = async (ctx: BotContext, employeeId: string) => {
    if (!(await allowed(ctx, 'salary:view'))) return;
    const { actor, currency, period } = await ctxInfo(ctx);
    const e = await salary.getEmployee(actor.companyId, employeeId);
    const r = await salary.getForEmployee(actor.companyId, employeeId, period);
    const m = (v: number) => formatMoney(v, currency);
    const lines = [`👤 ${e.name}`, `Должность: ${e.position}`, `Оклад: ${m(e.baseSalary.toNumber())}`, e.active ? '' : '⛔ Неактивен', '', `Период: ${period}`];
    if (r) {
      lines.push(
        `Оклад: ${m(r.baseSalary)}`,
        `Бонус: ${m(r.bonus)}`,
        `Штраф: ${m(r.penalty)}`,
        `Аванс: ${m(r.advance)}`,
        `Итого: ${m(r.total)}`,
        `Статус: ${STATUS_LABEL[r.status]}${r.paidAt ? ` (${r.paidAt.slice(0, 10)})` : ''}`,
      );
    } else lines.push('Зарплата за период ещё не рассчитана');
    const rows: ReturnType<typeof b>[][] = [];
    if (!r || r.status === 'DRAFT') {
      rows.push([b('🧮 Рассчитать', `sal:c:${e.id}`)]);
      rows.push([b('➕ Бонус', `sal:a:${e.id}:bonus`), b('➖ Штраф', `sal:a:${e.id}:penalty`), b('💵 Аванс', `sal:a:${e.id}:advance`)]);
    }
    if (r && r.status === 'DRAFT') rows.push([b('✅ Отметить выплату', `sal:pay:${r.id}`)]);
    rows.push([b('✏️ Изменить сотрудника', `emp:ed:${e.id}`)]);
    rows.push([b('◀️ К списку', 'm:sal')]);
    await show(ctx, lines.filter((l, i) => l !== '' || i > 3).join('\n'), Markup.inlineKeyboard(rows));
  };

  bot.action('m:sal', list);
  bot.action(/^sal:e:(\w+)$/, (ctx) => card(ctx, ctx.match[1]!));

  bot.action('sal:roll', async (ctx) => {
    if (!(await allowed(ctx, 'salary:view'))) return;
    const { actor, currency, period } = await ctxInfo(ctx);
    const p = await salary.payroll(actor.companyId, period);
    const m = (v: number) => formatMoney(v, currency);
    const lines = [`📋 ВЕДОМОСТЬ ${period}`, ''];
    for (const i of p.items) lines.push(`${i.employeeName}: ${m(i.total)} ${i.status === 'PAID' ? '✅' : '⏳'}`);
    if (p.missing.length) lines.push('', `Не рассчитано: ${p.missing.map((e) => e.name).join(', ')}`);
    lines.push('', `Оклады: ${m(p.totals.baseSalary)}`, `Бонусы: ${m(p.totals.bonus)}`, `Штрафы: ${m(p.totals.penalty)}`, `Авансы: ${m(p.totals.advance)}`);
    lines.push(`Итого: ${m(p.totals.total)}`, `Выплачено: ${m(p.totals.paid)}`, `К выплате: ${m(p.totals.unpaid)}`);
    await show(ctx, lines.join('\n'), Markup.inlineKeyboard([[b('◀️ К списку', 'm:sal')]]));
  });

  // ---- calculate one / all (with confirmation)
  bot.action(/^sal:c:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { actor, period } = await ctxInfo(ctx);
    const e = await salary.getEmployee(actor.companyId, ctx.match[1]!);
    await show(ctx, `Рассчитать зарплату ${e.name} за ${period}?\nОклад берётся из карточки сотрудника, бонусы/штрафы/авансы сохраняются.`, confirmKeyboard(`sal:cok:${e.id}`));
  });
  bot.action(/^sal:cok:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { actor, period } = await ctxInfo(ctx);
    await salary.calculate({ ...actor }, { employeeId: ctx.match[1]!, period });
    await ctx.answerCbQuery('Рассчитано').catch(() => {});
    await card(ctx, ctx.match[1]!);
  });
  bot.action('sal:all', async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { period } = await ctxInfo(ctx);
    await show(ctx, `Создать расчёт за ${period} для всех активных сотрудников без расчёта?`, confirmKeyboard('sal:allok'));
  });
  bot.action('sal:allok', async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { actor, period } = await ctxInfo(ctx);
    const res = await salary.calculateAll({ ...actor }, period);
    await ctx.answerCbQuery(`Создано: ${res.created}`).catch(() => {});
    await list(ctx);
  });

  // ---- bonus / penalty / advance: ask amount → confirm → apply
  bot.action(/^sal:a:(\w+):(bonus|penalty|advance)$/, async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { actor, period } = await ctxInfo(ctx);
    const e = await salary.getEmployee(actor.companyId, ctx.match[1]!);
    const field = ctx.match[2] as SalaryInputFlow['field'];
    ctx.session.flow = { kind: 'salary', startedAt: Date.now(), employeeId: e.id, employeeName: e.name, period, field };
    await show(ctx, `Введите сумму (${FIELD_LABEL[field]}) для ${e.name} за ${period}:`, Markup.inlineKeyboard([CANCEL_ROW]));
  });
  bot.action('sal:ok', async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const f = ctx.session.flow;
    if (!f || f.kind !== 'salary' || f.amount === undefined) {
      await ctx.answerCbQuery('Нечего подтверждать').catch(() => {});
      return;
    }
    ctx.session.flow = null;
    const actor = { ...actorOf(ctx) };
    let record = await salary.getForEmployee(actor.companyId, f.employeeId, f.period);
    if (!record) record = await salary.calculate(actor, { employeeId: f.employeeId, period: f.period });
    await salary.adjust(actor, record.id, { kind: f.field, amount: f.amount });
    await ctx.answerCbQuery('Сохранено').catch(() => {});
    await card(ctx, f.employeeId);
  });

  // ---- mark paid
  bot.action(/^sal:pay:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const { actor, currency } = await ctxInfo(ctx);
    const r = await salary.getById(actor.companyId, ctx.match[1]!);
    await show(ctx, `Отметить выплату ${r.employeeName} за ${r.period}: ${formatMoney(r.total, currency)}?\nПосле выплаты запись нельзя изменить.`, confirmKeyboard(`sal:pok:${r.id}`, '✅ Подтвердить выплату'));
  });
  bot.action(/^sal:pok:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'salary:manage'))) return;
    const actor = { ...actorOf(ctx) };
    const r = await salary.markPaid(actor, ctx.match[1]!);
    await ctx.answerCbQuery('Выплата отмечена').catch(() => {});
    await card(ctx, r.employeeId);
  });

  // ---- employees: add / edit
  bot.action('emp:new', async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    ctx.session.flow = { kind: 'employee-create', startedAt: Date.now(), step: 'name' };
    await show(ctx, '➕ НОВЫЙ СОТРУДНИК\nВведите имя:', Markup.inlineKeyboard([CANCEL_ROW]));
  });
  bot.action('emp:ok', async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const f = ctx.session.flow;
    if (!f || f.kind !== 'employee-create' || f.step !== 'confirm') {
      await ctx.answerCbQuery('Нечего подтверждать').catch(() => {});
      return;
    }
    ctx.session.flow = null;
    const e = await salary.createEmployee({ ...actorOf(ctx) }, { name: f.name, position: f.position, baseSalary: f.baseSalary });
    await ctx.answerCbQuery('Сотрудник добавлен').catch(() => {});
    await card(ctx, e.id);
  });
  bot.action(/^emp:ed:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const e = await salary.getEmployee(actorOf(ctx).companyId, ctx.match[1]!);
    await show(
      ctx,
      `✏️ ${e.name}\nЧто изменить?`,
      Markup.inlineKeyboard([
        [b('Имя', `emp:f:${e.id}:name`), b('Должность', `emp:f:${e.id}:position`), b('Оклад', `emp:f:${e.id}:baseSalary`)],
        [b(e.active ? '⛔ Деактивировать' : '✅ Активировать', `emp:act:${e.id}`)],
        [b('◀️ Назад', `sal:e:${e.id}`)],
      ]),
    );
  });
  bot.action(/^emp:f:(\w+):(name|position|baseSalary)$/, async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const e = await salary.getEmployee(actorOf(ctx).companyId, ctx.match[1]!);
    const field = ctx.match[2] as EmployeeEditFlow['field'];
    ctx.session.flow = { kind: 'employee-edit', startedAt: Date.now(), employeeId: e.id, employeeName: e.name, field };
    const label = { name: 'новое имя', position: 'новую должность', baseSalary: 'новый оклад' }[field];
    await show(ctx, `Введите ${label} для ${e.name}:`, Markup.inlineKeyboard([CANCEL_ROW]));
  });
  bot.action(/^emp:act:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const e = await salary.getEmployee(actorOf(ctx).companyId, ctx.match[1]!);
    await show(ctx, `${e.active ? 'Деактивировать' : 'Активировать'} ${e.name}?`, confirmKeyboard(`emp:actok:${e.id}`));
  });
  bot.action(/^emp:actok:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const actor = { ...actorOf(ctx) };
    const e = await salary.getEmployee(actor.companyId, ctx.match[1]!);
    await salary.updateEmployee(actor, e.id, { active: !e.active });
    await card(ctx, e.id);
  });
  bot.action('emp:eok', async (ctx) => {
    if (!(await allowed(ctx, 'employees:manage'))) return;
    const f = ctx.session.flow;
    if (!f || f.kind !== 'employee-edit' || f.value === undefined) {
      await ctx.answerCbQuery('Нечего подтверждать').catch(() => {});
      return;
    }
    ctx.session.flow = null;
    await salary.updateEmployee({ ...actorOf(ctx) }, f.employeeId, { [f.field]: f.value });
    await ctx.answerCbQuery('Сохранено').catch(() => {});
    await card(ctx, f.employeeId);
  });
}

/** Text input for salary / employee flows. Returns true when handled. */
export async function handleSalaryText(ctx: BotContext, deps: BotDeps, text: string): Promise<boolean> {
  const f = ctx.session.flow;
  if (!f) return false;
  const { currency } = await deps.services.reports.companyTimezone(actorOf(ctx).companyId);
  const money = (raw: string): number | string => {
    const n = parseNumberInput(raw);
    if (n === null) return 'Введите сумму числом, например 500000';
    const parsed = moneySchema.safeParse(n);
    return parsed.success ? parsed.data : (parsed.error.issues[0]?.message ?? 'Некорректная сумма');
  };

  if (f.kind === 'salary') {
    const amount = money(text);
    if (typeof amount === 'string' || amount <= 0) {
      await ctx.reply(`⚠️ ${typeof amount === 'string' ? amount : 'Сумма должна быть больше 0'}`, Markup.inlineKeyboard([CANCEL_ROW]));
      return true;
    }
    ctx.session.flow = { ...f, amount };
    await ctx.reply(
      `Подтвердите: ${FIELD_LABEL[f.field]} ${formatMoney(amount, currency)}\nСотрудник: ${f.employeeName}\nПериод: ${f.period}`,
      confirmKeyboard('sal:ok'),
    );
    return true;
  }

  if (f.kind === 'employee-create') {
    const value = text.trim();
    if (f.step === 'name' || f.step === 'position') {
      if (!value || value.length > 120) {
        await ctx.reply('⚠️ Введите от 1 до 120 символов', Markup.inlineKeyboard([CANCEL_ROW]));
        return true;
      }
      const next: EmployeeCreateFlow =
        f.step === 'name' ? { ...f, name: value, step: 'position' } : { ...f, position: value, step: 'salary' };
      ctx.session.flow = next;
      await ctx.reply(next.step === 'position' ? 'Введите должность:' : 'Введите оклад (в месяц):', Markup.inlineKeyboard([CANCEL_ROW]));
      return true;
    }
    if (f.step === 'salary') {
      const amount = money(value);
      if (typeof amount === 'string') {
        await ctx.reply(`⚠️ ${amount}`, Markup.inlineKeyboard([CANCEL_ROW]));
        return true;
      }
      ctx.session.flow = { ...f, baseSalary: amount, step: 'confirm' };
      await ctx.reply(
        `➕ НОВЫЙ СОТРУДНИК\n\nИмя: ${f.name}\nДолжность: ${f.position}\nОклад: ${formatMoney(amount, currency)}`,
        confirmKeyboard('emp:ok'),
      );
      return true;
    }
    return false;
  }

  if (f.kind === 'employee-edit') {
    let value: string | number = text.trim();
    if (f.field === 'baseSalary') {
      const amount = money(value);
      if (typeof amount === 'string') {
        await ctx.reply(`⚠️ ${amount}`, Markup.inlineKeyboard([CANCEL_ROW]));
        return true;
      }
      value = amount;
    } else if (!value || value.length > 120) {
      await ctx.reply('⚠️ Введите от 1 до 120 символов', Markup.inlineKeyboard([CANCEL_ROW]));
      return true;
    }
    ctx.session.flow = { ...f, value };
    const label = { name: 'Имя', position: 'Должность', baseSalary: 'Оклад' }[f.field];
    const shown = typeof value === 'number' ? formatMoney(value, currency) : value;
    await ctx.reply(`Подтвердите изменение (${f.employeeName}):\n${label}: ${shown}`, confirmKeyboard('emp:eok'));
    return true;
  }
  return false;
}
