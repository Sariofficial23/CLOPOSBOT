import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Telegraf } from 'telegraf';
import type { BotContext } from './bot/context';
import type { AppConfig } from './config/env';
import { loggerOptions } from './lib/logger';
import authPlugin from './plugins/auth';
import { registerErrorHandler } from './plugins/error-handler';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import catalogRoutes from './routes/catalog';
import cloposRoutes from './routes/clopos';
import dashboardRoutes from './routes/dashboard';
import healthRoutes from './routes/health';
import inventoryRoutes from './routes/inventory';
import reportRoutes from './routes/reports';
import salaryRoutes from './routes/salary';
import telegramRoutes from './routes/telegram';
import type { Services } from './services';

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  services: Services;
  bot?: Telegraf<BotContext> | null;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, prisma, services } = deps;
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY, // Render / Vercel sit behind a proxy
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandler(app, config.isProduction);

  await app.register(helmet, {
    // JSON API: no inline content is served
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // non-browser clients (curl, Telegram, Render health checks) send no Origin
      if (!origin) return cb(null, true);
      cb(null, config.corsOrigins.includes(origin.replace(/\/+$/, '')));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `Слишком много запросов. Повторите через ${Math.ceil(ctx.ttl / 1000)} с` },
    }),
  });

  await app.register(authPlugin, { config, services });

  await app.register(healthRoutes, { prisma, config });
  await app.register(authRoutes, { services });
  await app.register(dashboardRoutes, { services });
  await app.register(inventoryRoutes, { services });
  await app.register(catalogRoutes, { services });
  await app.register(reportRoutes, { services });
  await app.register(salaryRoutes, { services });
  await app.register(adminRoutes, { services });
  await app.register(cloposRoutes, { services });
  await app.register(telegramRoutes, { config, bot: deps.bot ?? null });

  return app;
}
