import { dateRangeQuerySchema } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

export default async function dashboardRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { dashboard, reports } = opts.services;

  app.get('/api/dashboard', { preHandler: app.guard('dashboard:view') }, async (req) => {
    const actor = actorOf(req);
    const q = parse(dateRangeQuerySchema, req.query);
    const range = await reports.resolveRange(actor.companyId, q, 'month');
    return ok(await dashboard.get(actor.companyId, range));
  });

  app.get('/api/sales', { preHandler: app.guard('sales:view') }, async (req) => {
    const actor = actorOf(req);
    const q = parse(dateRangeQuerySchema, req.query);
    const range = await reports.resolveRange(actor.companyId, q, 'week');
    const report = await reports.build(actor.companyId, range);
    return ok({ range: report.range, source: report.source, sales: report.sales, warnings: report.warnings });
  });
}
