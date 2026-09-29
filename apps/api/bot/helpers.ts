import { CloposError, CloposNotSupportedError } from '@cpos/clopos';
import { hasPermission, type Permission } from '@cpos/shared';
import type { Markup } from 'telegraf';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import type { Actor } from '../services/types';
import type { BotContext } from './context';

type Keyboard = ReturnType<typeof Markup.inlineKeyboard>;

export const TELEGRAM_TEXT_LIMIT = 4096;

/** Split long text on line boundaries to respect Telegram's 4096 char limit. */
export function chunkText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const piece = line.length > limit ? line.slice(0, limit) : line;
    if ((current ? current.length + 1 : 0) + piece.length > limit) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Edit the message behind a button press, or send a new one. */
export async function show(ctx: BotContext, text: string, keyboard?: Keyboard) {
  const [first, ...rest] = chunkText(text);
  if (ctx.callbackQuery && rest.length === 0) {
    try {
      await ctx.editMessageText(first!, keyboard);
      return;
    } catch (err) {
      if (err instanceof Error && err.message.includes('message is not modified')) return;
      // message too old / not editable → fall through to a new message
    }
  }
  for (const part of rest.length ? [first!, ...rest.slice(0, -1)] : []) await ctx.reply(part);
  await ctx.reply(rest.length ? rest[rest.length - 1]! : first!, keyboard);
}

export function actorOf(ctx: BotContext): Actor {
  if (!ctx.actor) throw new AppError(401, 'UNAUTHORIZED', 'Not authorized');
  return ctx.actor;
}

/** Returns false (and tells the user) when the actor lacks a permission. */
export async function allowed(ctx: BotContext, permission: Permission): Promise<boolean> {
  if (ctx.actor && hasPermission(ctx.actor.role, permission)) return true;
  if (ctx.callbackQuery) await ctx.answerCbQuery('⛔ Недостаточно прав', { show_alert: true }).catch(() => {});
  else await ctx.reply('⛔ Недостаточно прав для этого действия.');
  return false;
}

/** User-facing message for any error. Never exposes internals. */
export function userMessage(err: unknown): string {
  if (err instanceof ZodError) return `Проверьте данные: ${err.issues.map((i) => i.message).join('; ')}`;
  if (err instanceof AppError && err.statusCode < 500) return err.message;
  if (err instanceof CloposNotSupportedError) {
    return `Операция недоступна: Clopos Open API не предоставляет нужный endpoint.\nТребуется: ${err.required}`;
  }
  if (err instanceof CloposError) return 'Clopos временно недоступен или отклонил запрос. Попробуйте позже.';
  return 'Произошла ошибка. Попробуйте ещё раз или обратитесь к администратору.';
}

/** Callback data of the form "prefix:a:b" → ["a","b"]. */
export function cbArgs(ctx: BotContext): string[] {
  const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  return data.split(':').slice(1);
}
