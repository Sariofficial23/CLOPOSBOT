import { BOT_COMMANDS, createBot } from './bot/index';
import { prismaSessionStore } from './bot/session-store';
import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createPrisma } from './lib/prisma';
import { createServices } from './services';

async function main() {
  const config = loadConfig();
  const prisma = createPrisma();
  const services = createServices(prisma, config, console);

  const bot = config.TELEGRAM_BOT_TOKEN && config.telegramMode !== 'off'
    ? createBot(config.TELEGRAM_BOT_TOKEN, {
        resolveActor: (id) => services.auth.resolveTelegramActor(id),
        services,
        sessionStore: prismaSessionStore(prisma),
        logger: console,
      })
    : null;

  const app = await buildApp({ config, prisma, services, bot });

  await app.listen({ host: config.HOST, port: config.port });
  app.log.info({ cloposAdapter: config.CLOPOS_ADAPTER, telegram: config.telegramMode }, 'server started');

  if (bot) {
    await bot.telegram.setMyCommands(BOT_COMMANDS).catch((err: Error) => app.log.warn({ err: err.message }, 'setMyCommands failed'));
    if (config.telegramMode === 'polling') {
      await bot.telegram.deleteWebhook().catch(() => {});
      // launch() resolves only when polling stops — don't await it
      bot.launch().catch((err: Error) => app.log.error({ err: err.message }, 'bot polling stopped'));
      app.log.info('telegram bot: long polling');
    } else {
      const url = `${config.BACKEND_URL.replace(/\/+$/, '')}/api/telegram/webhook`;
      await bot.telegram
        .setWebhook(url, { secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] })
        .then(() => app.log.info({ url }, 'telegram webhook set'))
        .catch((err: Error) => app.log.error({ err: err.message }, 'setWebhook failed'));
    }
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    if (bot && config.telegramMode === 'polling') bot.stop(signal);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // config errors list variable names only, never values
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
