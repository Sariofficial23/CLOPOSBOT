import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env';
import type { PrismaClient } from '@prisma/client';

export default async function healthRoutes(app: FastifyInstance, opts: { prisma: PrismaClient; config: AppConfig }) {
  app.get('/api/health', { config: { rateLimit: false } }, async (_req, reply) => {
    let db = 'ok';
    try {
      await opts.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    const healthy = db === 'ok';
    reply.status(healthy ? 200 : 503);
    return {
      success: healthy,
      data: {
        status: healthy ? 'ok' : 'degraded',
        db,
        cloposAdapter: opts.config.CLOPOS_ADAPTER,
        telegram: opts.config.telegramMode,
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    };
  });
}
