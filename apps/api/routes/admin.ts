import { paginationQuerySchema } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

const idParams = z.object({ id: z.string().min(1).max(64) });

/** audit, settings, users, schedules, company */
export default async function adminRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { audit, auth, company, schedules } = opts.services;

  app.get('/api/audit', { preHandler: app.guard('audit:view') }, async (req) => {
    const page = parse(paginationQuerySchema, req.query);
    const f = parse(
      z.object({ action: z.string().max(64).optional(), entity: z.string().max(64).optional(), userId: z.string().max(64).optional() }),
      req.query,
    );
    return ok(await audit.list(actorOf(req).companyId, { ...page, ...f }));
  });

  app.get('/api/settings', { preHandler: app.guard() }, async (req) => ok(await company.get(actorOf(req).companyId)));

  app.patch('/api/settings', { preHandler: app.guard('settings:manage') }, async (req) => ok(await company.update(actorOf(req), req.body)));

  app.get('/api/report-schedules', { preHandler: app.guard('reports:schedule') }, async (req) =>
    ok(await schedules.list(actorOf(req).companyId)),
  );

  app.put('/api/report-schedules', { preHandler: app.guard('reports:schedule') }, async (req) => ok(await schedules.upsert(actorOf(req), req.body)));

  app.get('/api/users', { preHandler: app.guard('users:manage') }, async (req) => ok(await auth.listUsers(actorOf(req).companyId)));

  app.post('/api/users', { preHandler: app.guard('users:manage') }, async (req, reply) => {
    reply.status(201);
    return ok(await auth.createUser(actorOf(req), req.body));
  });

  app.patch('/api/users/:id', { preHandler: app.guard('users:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await auth.updateUser(actorOf(req), id, req.body));
  });

  app.delete('/api/companies/:id', { preHandler: app.guard('company:delete') }, async (req) => {
    const { id } = parse(idParams, req.params);
    await company.remove(actorOf(req), id);
    return ok({ deleted: true });
  });
}
