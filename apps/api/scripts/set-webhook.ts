/** Manually (re)register the Telegram webhook: pnpm --filter @cpos/api bot:set-webhook */
import { Telegram } from 'telegraf';
import { BOT_COMMANDS } from '../bot/index';
import { loadConfig } from '../config/env';

async function main() {
  const config = loadConfig(process.env, 'worker');
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (!config.TELEGRAM_WEBHOOK_SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
  const telegram = new Telegram(config.TELEGRAM_BOT_TOKEN);
  const url = `${config.BACKEND_URL.replace(/\/+$/, '')}/api/telegram/webhook`;
  await telegram.setWebhook(url, { secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
  await telegram.setMyCommands(BOT_COMMANDS);
  const info = await telegram.getWebhookInfo();
  console.log(`Webhook set: ${info.url} (pending updates: ${info.pending_update_count})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
