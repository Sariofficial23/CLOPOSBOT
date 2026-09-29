import { dateRangeQuerySchema, paginationQuerySchema } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

export default async function inventoryRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { clopos, reports, incoming } = opts.services;

  app.get('/api/inventory', { preHandler: app.guard('stock:view') }, async (req) => {
    const actor = actorOf(req);
    const service = await clopos.forCompany(actor.companyId);
    const [products, categories, inventory] = await Promise.all([
      service.capabilities.products ? service.getProducts() : Promise.resolve([]),
      service.capabilities.categories ? service.getCategories().catch(() => []) : Promise.resolve([]),
      reports.inventory(actor.companyId),
    ]);
    const stock = service.capabilities.stock ? await service.getStock() : null;
    return ok({ mode: service.mode, capabilities: service.capabilities, products, categories, stock, summary: inventory });
  });

  app.get('/api/incoming', { preHandler: app.guard('incoming:view') }, async (req) => {
    const actor = actorOf(req);
    const page = parse(paginationQuerySchema, req.query);
    const q = parse(dateRangeQuerySchema, req.query);
    const range = q.preset || (q.from && q.to) ? await reports.resolveRange(actor.companyId, q, 'month') : null;
    return ok(await incoming.list(actor.companyId, { ...page, from: range?.from, to: range?.to }));
  });

  app.get('/api/incoming/options', { preHandler: app.guard('incoming:create') }, async (req) => {
    return ok(await incoming.options(actorOf(req).companyId));
  });

  app.post('/api/incoming', { preHandler: app.guard('incoming:create') }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    const idempotencyKey = typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : undefined;
    const result = await incoming.create(actorOf(req), req.body, { source: 'web', idempotencyKey });
    reply.status(result.duplicate ? 200 : 201);
    return ok(result);
  });
}
