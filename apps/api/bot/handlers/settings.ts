import { hasPermission } from '@cpos/shared';
import { Markup, type Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import type { BotDeps } from '../index';
import { actorOf, allowed, show } from '../helpers';
import { backToMenu, confirmKeyboard } from '../keyboards';

const TYPE_LABEL = { DAILY: 'Ежедневный', WEEKLY: 'Еженедельный', MONTHLY: 'Ежемесячный' } as const;
const DOW = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
type ScheduleType = keyof typeof TYPE_LABEL;

function when(s: { type: ScheduleType; hour: number; minute: number; dayOfWeek: number | null; dayOfMonth: number | null }) {
  const t = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  if (s.type === 'WEEKLY') return `${DOW[s.dayOfWeek ?? 1]} ${t}`;
  if (s.type === 'MONTHLY') return `${s.dayOfMonth}-го числа ${t}`;
  return t;
}

export function registerSettings(bot: Telegraf<BotContext>, deps: BotDeps) {
  const { company, schedules, clopos } = deps.services;

  const render = async (ctx: BotContext) => {
    if (!(await allowed(ctx, 'reports:schedule'))) return;
    const actor = actorOf(ctx);
    const [c, list] = await Promise.all([company.get(actor.companyId), schedules.list(actor.companyId)]);
    const lines = ['⚙️ НАСТРОЙКИ', '', `Компания: ${c.name}`, `Часовой пояс: ${c.timezone}`, `Валюта: ${c.currency}`];
    if (hasPermission(actor.role, 'clopos:manage')) {
      const st = await clopos.status(actor.companyId);
      lines.push('', `Clopos: ${st.mode === 'mock' ? 'MOCK (тестовые данные)' : st.connected ? `подключён (brand: ${st.brand})` : 'не подключён'}`);
      if (st.lastError) lines.push(`Последняя ошибка: ${st.lastError}`);
    }
    lines.push('', 'Авто-отчёты (время компании):');
    for (const s of list) lines.push(`${s.enabled ? '🟢' : '⚪️'} ${TYPE_LABEL[s.type]} — ${when(s)}`);
    lines.push('', 'Точное время и получателей можно настроить в веб-панели.');
    const rows = list.map((s) => [Markup.button.callback(`${s.enabled ? 'Выключить' : 'Включить'}: ${TYPE_LABEL[s.type]}`, `set:t:${s.type}`)]);
    rows.push(backToMenu());
    await show(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  };

  bot.action('m:set', render);

  bot.action(/^set:t:(DAILY|WEEKLY|MONTHLY)$/, async (ctx) => {
    if (!(await allowed(ctx, 'reports:schedule'))) return;
    const type = ctx.match[1] as ScheduleType;
    const s = (await schedules.list(actorOf(ctx).companyId)).find((x) => x.type === type)!;
    await show(ctx, `${s.enabled ? 'Выключить' : 'Включить'} ${TYPE_LABEL[type].toLowerCase()} отчёт (${when(s)})?`, confirmKeyboard(`set:ok:${type}`));
  });

  bot.action(/^set:ok:(DAILY|WEEKLY|MONTHLY)$/, async (ctx) => {
    if (!(await allowed(ctx, 'reports:schedule'))) return;
    await schedules.toggle({ ...actorOf(ctx) }, ctx.match[1] as ScheduleType);
    await ctx.answerCbQuery('Сохранено').catch(() => {});
    await render(ctx);
  });
}
