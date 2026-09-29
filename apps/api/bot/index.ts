/**
 * Telegram bot (Telegraf).
 *
 * Security:
 *  - every update is from a verified Telegram user (webhook secret checked in
 *    routes/telegram.ts; polling talks to Telegram directly)
 *  - the Telegram user id must belong to an active User (companies add users
 *    by Telegram ID in the dashboard) — everyone else gets "no access"
 *  - private chats only; group chats only receive scheduled reports
 *  - every section checks role permissions; mutations require confirmation
 *    and are audit-logged by the services
 */
import { hasPermission, type Permission } from '@cpos/shared';
import { session, Telegraf } from 'telegraf';
import type { UserFromGetMe } from 'telegraf/types';
import type { Services } from '../services';
import { AuditAction } from '../services/audit.service';
import type { Actor } from '../services/types';
import { type BotContext, type BotSession, FLOW_TTL_MS } from './context';
import { registerIncoming, handleIncomingText } from './handlers/incoming';
import { HELP_TEXT, registerMenu, showMainMenu } from './handlers/menu';
import { registerReports } from './handlers/reports';
import { handleSalaryText, registerSalary } from './handlers/salary';
import { registerSettings } from './handlers/settings';
import { handleStockText, registerStock } from './handlers/stock';
import { userMessage } from './helpers';

export interface BotLogger {
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

export interface SessionStoreLike {
  get(key: string): Promise<BotSession | undefined>;
  set(key: string, value: BotSession): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface BotDeps {
  resolveActor: (telegramId: string) => Promise<Actor | null>;
  services: Pick<Services, 'reports' | 'incoming' | 'salary' | 'schedules' | 'company' | 'clopos' | 'audit' | 'stockImport'>;
  sessionStore: SessionStoreLike;
  logger?: BotLogger;
  newId?: () => string;
  /** test hook: download a Telegram file */
  downloadFile?: (ctx: BotContext, fileId: string) => Promise<Buffer>;
  can: (actor: Actor, permission: Permission) => boolean;
}

/** simple per-user flood protection */
function rateLimiter(max = 30, windowMs = 10_000) {
  const hits = new Map<number, number[]>();
  return (userId: number, now = Date.now()) => {
    const recent = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(userId, recent);
    if (hits.size > 10_000) hits.clear();
    return recent.length <= max;
  };
}

export function createBot(token: string, depsIn: Omit<BotDeps, 'can'> & Partial<Pick<BotDeps, 'can'>>, opts: { botInfo?: UserFromGetMe } = {}): Telegraf<BotContext> {
  const deps: BotDeps = { ...depsIn, can: depsIn.can ?? ((a, p) => hasPermission(a.role, p)) };
  const bot = new Telegraf<BotContext>(token, { handlerTimeout: 60_000 });
  if (opts.botInfo) bot.botInfo = opts.botInfo;
  const limit = rateLimiter();

  bot.catch(async (err, ctx) => {
    deps.logger?.error({ err: err instanceof Error ? { name: err.name, message: err.message } : err, update: ctx.updateType }, 'bot handler error');
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(`⚠️ ${userMessage(err)}`);
    } catch {
      /* chat unreachable */
    }
  });

  // 1. private chats only
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    if (!ctx.from || ctx.from.is_bot) return;
    if (!limit(ctx.from.id)) return;
    return next();
  });

  // 2. commands that work without an account
  bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}\nПередайте его администратору для доступа.`));

  // 3. Telegram user verification → Actor
  bot.use(async (ctx, next) => {
    const actor = await deps.resolveActor(String(ctx.from!.id));
    if (!actor) {
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start')) {
        await deps.services.audit.log({
          action: AuditAction.AUTH_BOT_DENIED,
          entity: 'TelegramUser',
          entityId: String(ctx.from!.id),
          metadata: { username: ctx.from!.username ?? null },
        });
      }
      if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Нет доступа').catch(() => {});
      await ctx.reply(`⛔ Нет доступа.\nВаш Telegram ID: ${ctx.from!.id}\nПопросите администратора добавить вас в системе.`);
      return;
    }
    ctx.actor = actor;
    return next();
  });

  // 4. sessions (Postgres) + flow expiry
  bot.use(session({ store: deps.sessionStore, defaultSession: (): BotSession => ({ flow: null }) }));
  bot.use(async (ctx, next) => {
    const f = ctx.session.flow;
    if (f && Date.now() - f.startedAt > FLOW_TTL_MS) ctx.session.flow = null;
    return next();
  });

  // 5. answer every button press so Telegram stops the spinner
  bot.on('callback_query', async (ctx, next) => {
    await next();
    await ctx.answerCbQuery().catch(() => {});
  });

  const cancel = async (ctx: BotContext) => {
    const had = !!ctx.session.flow;
    ctx.session.flow = null;
    if (ctx.callbackQuery) await ctx.answerCbQuery(had ? 'Отменено' : '').catch(() => {});
    else await ctx.reply(had ? '❌ Действие отменено.' : 'Нечего отменять.');
    await showMainMenu(ctx);
  };
  bot.command('cancel', cancel);
  bot.action('x', cancel);

  registerMenu(bot, deps);
  registerReports(bot, deps);
  registerIncoming(bot, deps);
  registerSalary(bot, deps);
  registerSettings(bot, deps);
  registerStock(bot, deps);

  // free text → active flow
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      await ctx.reply(`Неизвестная команда.\n${HELP_TEXT}`);
      return;
    }
    if (text.length > 500) {
      await ctx.reply('⚠️ Слишком длинное сообщение');
      return;
    }
    if (await handleIncomingText(ctx, deps, text)) return;
    if (await handleSalaryText(ctx, deps, text)) return;
    if (await handleStockText(ctx, deps, text)) return;
    await showMainMenu(ctx);
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: 'menu', description: 'Главное меню' },
  { command: 'incoming', description: 'Приход товара' },
  { command: 'today', description: 'Отчёт за сегодня' },
  { command: 'yesterday', description: 'Отчёт за вчера' },
  { command: 'week', description: 'Отчёт за неделю' },
  { command: 'month', description: 'Отчёт за месяц' },
  { command: 'cancel', description: 'Отменить действие' },
  { command: 'id', description: 'Мой Telegram ID' },
];
