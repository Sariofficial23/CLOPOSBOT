import type { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed-data';

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * First-run bootstrap for hosts without a shell (e.g. Render free plan):
 * when the database has no users and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 * are set, create the company and the SUPER_ADMIN. Never runs again once any
 * user exists, so the variables can stay set (or be removed afterwards).
 */
export async function bootstrapAdmin(prisma: PrismaClient, env: NodeJS.ProcessEnv, log: Logger): Promise<boolean> {
  const email = env.SEED_ADMIN_EMAIL?.trim();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return false;
  if ((await prisma.user.count()) > 0) return false;
  if (password.length < 8) {
    log.warn({}, 'SEED_ADMIN_PASSWORD must be at least 8 characters — admin not created');
    return false;
  }
  await seed(prisma, {
    adminEmail: email.toLowerCase(),
    adminPassword: password,
    adminTelegramId: env.SEED_ADMIN_TELEGRAM_ID?.trim() || null,
    companyName: env.SEED_COMPANY_NAME?.trim() || undefined,
    timezone: env.TIMEZONE,
    demoUsers: false,
    demoData: false,
  });
  log.info({ email: email.toLowerCase() }, 'bootstrap: company and SUPER_ADMIN created');
  return true;
}
