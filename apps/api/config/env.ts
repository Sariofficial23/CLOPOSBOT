import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** server (web service) or worker (cron job: no PORT / webhook needed) */
    APP_ROLE: z.enum(['server', 'worker']).default('server'),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('12h'),
    /** 32-byte key, base64 or hex — encrypts Clopos credentials/tokens at rest */
    ENCRYPTION_KEY: z.string().min(32),

    FRONTEND_URL: z.string().default('http://localhost:3000'),
    BACKEND_URL: z.string().default('http://localhost:3001'),
    TIMEZONE: z.string().default('Asia/Tashkent'),

    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    /** webhook (Render), polling (local dev) or off */
    TELEGRAM_MODE: z.enum(['webhook', 'polling', 'off']).optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    CLOPOS_ADAPTER: z.enum(['real', 'mock']).default('real'),
    CLOPOS_API_URL: z.string().url().default('https://integrations.clopos.com/open-api'),
    CLOPOS_CLIENT_ID: z.string().optional(),
    CLOPOS_CLIENT_SECRET: z.string().optional(),
    CLOPOS_INTEGRATOR_ID: z.string().optional(),
    CLOPOS_REDIRECT_URI: z.string().optional(),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    TRUST_PROXY: bool.default(true),
    /** max minutes after a scheduled time during which a report is still sent */
    REPORT_MAX_LAG_MINUTES: z.coerce.number().int().positive().default(180),
  })
  .superRefine((env, ctx) => {
    const isWorker = env.APP_ROLE === 'worker';
    if (env.NODE_ENV === 'production') {
      if (!env.PORT && !isWorker) ctx.addIssue({ code: 'custom', path: ['PORT'], message: 'PORT is required in production (Render sets it)' });
      if (env.CLOPOS_ADAPTER === 'mock') {
        ctx.addIssue({ code: 'custom', path: ['CLOPOS_ADAPTER'], message: 'MockCloposService is not allowed in production' });
      }
      const mode = env.TELEGRAM_MODE ?? (env.TELEGRAM_BOT_TOKEN ? 'webhook' : 'off');
      if (!isWorker && mode === 'webhook' && (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 16)) {
        ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'At least 16 chars required for webhook mode' });
      }
    }
    if (env.TELEGRAM_WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'Only A-Z a-z 0-9 _ - allowed (Telegram rule)' });
    }
  });

export type RawEnv = z.infer<typeof schema>;

export interface AppConfig extends RawEnv {
  port: number;
  telegramMode: 'webhook' | 'polling' | 'off';
  corsOrigins: string[];
  isProduction: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env, role?: 'server' | 'worker'): AppConfig {
  const parsed = schema.safeParse(role ? { ...source, APP_ROLE: role } : source);
  if (!parsed.success) {
    // print variable names and reasons only — never values
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const telegramMode = env.TELEGRAM_MODE ?? (env.TELEGRAM_BOT_TOKEN ? (env.NODE_ENV === 'production' ? 'webhook' : 'polling') : 'off');
  return {
    ...env,
    // local fallback only; production requires PORT (validated above)
    port: env.PORT ?? 3001,
    telegramMode: env.TELEGRAM_BOT_TOKEN ? telegramMode : 'off',
    corsOrigins: env.FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}
