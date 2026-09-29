import { formatMoney, resolvePreset, ROLE_LABELS } from '@cpos/shared';
import type { Telegraf } from 'telegraf';
import type { BotDeps } from '../index';
import type { BotContext } from '../context';
import { actorOf, allowed, show } from '../helpers';
import { backToMenu, mainMenu } from '../keyboards';
import { Markup } from 'telegraf';

export const HELP_TEXT = [
  'Команды:',
  '/menu — главное меню',
  '/incoming — приход товара',
  '/today /yesterday /week /month — отчёты',
  '/cancel — отменить текущее действие',
  '/id — ваш Telegram ID',
].join('\n');

export async function showMainMenu(ctx: BotContext) {
  const actor = actorOf(ctx);
  await show(ctx, `Главное меню\n${actor.name} · ${ROLE_LABELS[actor.role]}`, mainMenu(actor.role));
}

export function registerMenu(bot: Telegraf<BotContext>, deps: BotDeps) {
  bot.start(showMainMenu);
  bot.command('menu', showMainMenu);
  bot.command('help', (ctx) => ctx.reply(HELP_TEXT));
  bot.action('m:main', async (ctx) => {
    ctx.session.flow = null;
    await showMainMenu(ctx);
  });

  bot.action('m:dash', async (ctx) => {
    if (!(await allowed(ctx, 'dashboard:view'))) return;
    const actor = actorOf(ctx);
    const { timezone, currency } = await deps.services.reports.companyTimezone(actor.companyId);
    const [today, month] = await Promise.all([
      deps.services.reports.build(actor.companyId, resolvePreset('today', timezone)),
      deps.services.reports.build(actor.companyId, resolvePreset('month', timezone)),
    ]);
    const m = (v: number | null) => (v === null ? 'нет данных' : formatMoney(v, currency));
    const lines = [
      '📊 DASHBOARD',
      today.source === 'mock' ? '⚠️ ТЕСТОВЫЕ ДАННЫЕ (MockCloposService)' : '',
      '',
      'Сегодня:',
      `  Продажи: ${m(today.sales.sales)}`,
      `  Заказов: ${today.sales.orders}`,
      `  Валовая прибыль: ${m(today.sales.grossProfit)}`,
      '',
      'С начала месяца:',
      `  Продажи: ${m(month.sales.sales)}`,
      `  Заказов: ${month.sales.orders}`,
      `  Валовая прибыль: ${m(month.sales.grossProfit)}`,
      `  Приходы: ${m(month.expenses.incoming)}`,
      `  Выплачено зарплаты: ${m(month.expenses.salary)}`,
    ].filter((l, i) => l !== '' || i !== 1);
    await show(ctx, lines.join('\n'), Markup.inlineKeyboard([[Markup.button.callback('🔄 Обновить', 'm:dash')], backToMenu()]));
  });

  bot.action('m:sales', async (ctx) => {
    if (!(await allowed(ctx, 'sales:view'))) return;
    const actor = actorOf(ctx);
    const { timezone, currency } = await deps.services.reports.companyTimezone(actor.companyId);
    const r = await deps.services.reports.build(actor.companyId, resolvePreset('today', timezone));
    const s = r.sales;
    const lines = [
      '💵 ПРОДАЖИ СЕГОДНЯ',
      r.source === 'mock' ? '⚠️ ТЕСТОВЫЕ ДАННЫЕ' : null,
      '',
      `Продажи: ${formatMoney(s.sales, currency)}`,
      `Заказов: ${s.orders}`,
      `Средний чек: ${formatMoney(s.averageCheck, currency)}`,
      '',
      'Способы оплаты:',
      ...(s.paymentMethods.length ? s.paymentMethods.map((p) => `  ${p.name}: ${formatMoney(p.amount, currency)}`) : ['  нет продаж']),
    ].filter((l): l is string => l !== null);
    await show(
      ctx,
      lines.join('\n'),
      Markup.inlineKeyboard([
        [Markup.button.callback('Вчера', 'r:yesterday'), Markup.button.callback('Неделя', 'r:week'), Markup.button.callback('Месяц', 'r:month')],
        backToMenu(),
      ]),
    );
  });
}
