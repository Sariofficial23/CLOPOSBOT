import type { FastifyInstance } from 'fastify';
import type { Telegraf } from 'telegraf';
import type { Update } from 'telegraf/types';
import type { AppConfig } from '../config/env';
import { safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { BotContext } from '../bot/context';

/**
 * Telegram webhook. Telegram sends the secret configured via setWebhook in the
 * X-Telegram-Bot-Api-Secret-Token header; anything else is rejected.
 */
export default async function telegramRoutes(app: FastifyInstance, opts: { config: AppConfig; bot: Telegraf<BotContext> | null }) {
  app.post('/api/telegram/webhook', { config: { rateLimit: { max: 1000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = opts.config.TELEGRAM_WEBHOOK_SECRET;
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (!opts.bot || opts.config.telegramMode !== 'webhook' || !secret) {
      throw new AppError(404, 'NOT_FOUND', 'Webhook is not enabled');
    }
    if (typeof header !== 'string' || !safeEqual(header, secret)) {
      throw new AppError(401, 'INVALID_WEBHOOK_SECRET', 'Invalid webhook secret');
    }
    // Respond quickly; errors inside handlers are caught by bot.catch
    await opts.bot.handleUpdate(req.body as Update);
    reply.status(200);
    return { ok: true };
  });
}
