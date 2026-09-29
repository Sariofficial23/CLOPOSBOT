/**
 * Scheduled report worker.
 *
 * Render Cron Job (UTC):   node dist/worker/scheduled-reports.js        (e.g. every 15 minutes)
 * Local / background loop: node dist/worker/scheduled-reports.js --loop
 *
 * Idempotent: each schedule occurrence is claimed via a unique
 * ReportDelivery row, so overlapping or repeated runs never double-send.
 */
import { Telegram } from 'telegraf';
import { chunkText } from '../bot/helpers';
import { loadConfig } from '../config/env';
import { createPrisma } from '../lib/prisma';
import { createServices } from '../services';

const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ level: 'info', msg, ...extra, time: new Date().toISOString() }));

async function runOnce() {
  const config = loadConfig(process.env, 'worker');
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required for the report worker');
  const prisma = createPrisma();
  const services = createServices(prisma, config, console);
  const telegram = new Telegram(config.TELEGRAM_BOT_TOKEN);
  try {
    const summary = await services.schedules.runDue(async (chatId, text) => {
      for (const part of chunkText(text)) await telegram.sendMessage(chatId, part);
    }, new Date(), log);
    // housekeeping
    const sessions = await prisma.botSession.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
    const deliveries = await prisma.reportDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } });
    log('scheduled reports run finished', { ...summary, cleanedSessions: sessions.count, cleanedDeliveries: deliveries.count });
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.argv.includes('--loop')) {
    const intervalMs = 5 * 60_000;
    for (;;) {
      await runOnce().catch((err) => console.error(JSON.stringify({ level: 'error', msg: 'run failed', error: String(err?.message ?? err) })));
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  await runOnce();
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'report worker crashed', error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
