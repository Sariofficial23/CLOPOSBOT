import type { ReportPreset } from '@cpos/shared';
import type { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { BotContext } from '../context';
import type { BotDeps } from '../index';
import { actorOf, allowed, show } from '../helpers';
import { backToMenu, reportsMenu } from '../keyboards';

const COMMANDS: Record<string, ReportPreset> = { today: 'today', yesterday: 'yesterday', week: 'week', month: 'month' };
const PRESETS: ReportPreset[] = ['today', 'yesterday', 'week', 'month', 'last_week', 'last_month'];

export function registerReports(bot: Telegraf<BotContext>, deps: BotDeps) {
  const send = async (ctx: BotContext, preset: ReportPreset) => {
    if (!(await allowed(ctx, 'reports:view'))) return;
    const text = await deps.services.reports.generateText({ ...actorOf(ctx) }, preset, 'telegram');
    await show(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('📈 Другие отчёты', 'm:rep')], backToMenu()]));
  };

  for (const [cmd, preset] of Object.entries(COMMANDS)) bot.command(cmd, (ctx) => send(ctx, preset));

  bot.action('m:rep', async (ctx) => {
    if (!(await allowed(ctx, 'reports:view'))) return;
    await show(ctx, '📈 ОТЧЁТЫ\nВыберите период:', reportsMenu());
  });

  bot.action(/^r:([a-z_]+)$/, async (ctx) => {
    const preset = ctx.match[1] as ReportPreset;
    if (!PRESETS.includes(preset)) return;
    await send(ctx, preset);
  });
}
