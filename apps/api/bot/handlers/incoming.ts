import { formatMoney } from '@cpos/shared';
import { randomUUID } from 'node:crypto';
import { Markup, type Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import {
  back,
  enterText,
  type IncomingFlowState,
  selectOption,
  setPage,
  startIncoming,
  stepPrompt,
  summaryText,
  toIncomingInput,
} from '../flows/incoming.flow';
import type { BotDeps } from '../index';
import { actorOf, allowed, show, userMessage } from '../helpers';
import { backToMenu, incomingKeyboard } from '../keyboards';

const STATUS_TEXT: Record<string, string> = {
  SYNCED: '✅ Приход отправлен в Clopos',
  LOCAL_ONLY: '💾 Приход сохранён локально (Clopos API не поддерживает создание приходов)',
  FAILED: '⚠️ Приход сохранён локально, но Clopos вернул ошибку — повторите позже',
  PENDING: '⏳ Приход сохранён, отправка в Clopos ещё выполняется',
};

function flowOf(ctx: BotContext): IncomingFlowState | null {
  const f = ctx.session.flow;
  return f && f.kind === 'incoming' ? f : null;
}

export async function renderIncoming(ctx: BotContext, state: IncomingFlowState, currency: string) {
  const text = state.step === 'confirm' ? summaryText(state, currency) : stepPrompt(state);
  await show(ctx, text, incomingKeyboard(state));
}

export function registerIncoming(bot: Telegraf<BotContext>, deps: BotDeps) {
  const currencyOf = async (ctx: BotContext) => (await deps.services.reports.companyTimezone(actorOf(ctx).companyId)).currency;

  const begin = async (ctx: BotContext) => {
    if (!(await allowed(ctx, 'incoming:create'))) return;
    const actor = actorOf(ctx);
    const options = await deps.services.incoming.options(actor.companyId);
    if (!options.available) {
      await show(ctx, `📦 ПРИХОД ТОВАРА\n\n${options.reason}`, Markup.inlineKeyboard([backToMenu()]));
      return;
    }
    if (!options.storages.length || !options.suppliers.length || !options.products.length) {
      await show(ctx, 'В Clopos нет складов, поставщиков или товаров для прихода.', Markup.inlineKeyboard([backToMenu()]));
      return;
    }
    const pick = (o: { id: string; name: string }) => ({ id: o.id, name: o.name });
    const state = startIncoming(
      (deps.newId ?? randomUUID)(),
      options.storages.map(pick),
      options.suppliers.map(pick),
      options.products.map(pick),
    );
    ctx.session.flow = state;
    await renderIncoming(ctx, state, await currencyOf(ctx));
  };

  bot.command('incoming', begin);
  bot.action('m:inc', begin);

  const step = async (ctx: BotContext, update: (s: IncomingFlowState) => { ok: boolean; error?: string; state: IncomingFlowState }) => {
    const state = flowOf(ctx);
    if (!state) {
      await ctx.answerCbQuery('Сценарий устарел, начните заново: /incoming').catch(() => {});
      return;
    }
    const res = update(state);
    if (!res.ok) {
      await ctx.answerCbQuery(res.error ?? 'Ошибка', { show_alert: true }).catch(() => {});
      return;
    }
    ctx.session.flow = res.state;
    await renderIncoming(ctx, res.state, await currencyOf(ctx));
  };

  bot.action(/^inc:s:(\d+)$/, (ctx) => step(ctx, (s) => selectOption(s, 'storage', Number(ctx.match[1]))));
  bot.action(/^inc:u:(\d+)$/, (ctx) => step(ctx, (s) => selectOption(s, 'supplier', Number(ctx.match[1]))));
  bot.action(/^inc:p:(\d+)$/, (ctx) => step(ctx, (s) => selectOption(s, 'product', Number(ctx.match[1]))));
  bot.action(/^inc:pg:(\d+)$/, (ctx) => step(ctx, (s) => ({ ok: true, state: setPage(s, Number(ctx.match[1])) })));
  bot.action('inc:clr', (ctx) => step(ctx, (s) => ({ ok: true, state: { ...s, filter: undefined, page: 0 } })));
  bot.action('inc:back', (ctx) => step(ctx, (s) => ({ ok: true, state: back(s) })));

  bot.action('inc:ok', async (ctx) => {
    if (!(await allowed(ctx, 'incoming:create'))) return;
    const state = flowOf(ctx);
    if (!state || state.step !== 'confirm') {
      await ctx.answerCbQuery('Нечего подтверждать').catch(() => {});
      return;
    }
    // clear first: a double tap can't submit twice (and the flow id is the idempotency key anyway)
    ctx.session.flow = null;
    await ctx.answerCbQuery('Отправляю…').catch(() => {});
    const currency = await currencyOf(ctx);
    try {
      const { incoming } = await deps.services.incoming.create({ ...actorOf(ctx) }, toIncomingInput(state), {
        source: 'telegram',
        idempotencyKey: state.id,
      });
      await show(
        ctx,
        [summaryText(state, currency), '', STATUS_TEXT[incoming.status] ?? incoming.status, `Итого: ${formatMoney(incoming.total, currency)}`].join('\n'),
        Markup.inlineKeyboard([[Markup.button.callback('📦 Ещё приход', 'm:inc')], backToMenu()]),
      );
    } catch (err) {
      deps.logger?.error({ err: err instanceof Error ? err.message : err }, 'incoming create failed');
      ctx.session.flow = state; // let the user retry the same (idempotent) submission
      await show(ctx, `❌ ${userMessage(err)}`, incomingKeyboard(state));
    }
  });
}

/** Text input while the incoming flow is active. Returns true when handled. */
export async function handleIncomingText(ctx: BotContext, deps: BotDeps, text: string): Promise<boolean> {
  const state = flowOf(ctx);
  if (!state) return false;
  const res = enterText(state, text);
  const currency = (await deps.services.reports.companyTimezone(actorOf(ctx).companyId)).currency;
  if (!res.ok) {
    await ctx.reply(`⚠️ ${res.error}`, incomingKeyboard(state));
    return true;
  }
  ctx.session.flow = res.state;
  await renderIncoming(ctx, res.state, currency);
  return true;
}
