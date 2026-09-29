import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

const idParams = z.object({ id: z.string().min(1).max(64) });

/** Local warehouses & suppliers (used when Clopos has no endpoints for them). */
export default async function catalogRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { catalog } = opts.services;

  app.get('/api/warehouses', { preHandler: app.guard('incoming:view') }, async (req) => ok(await catalog.listWarehouses(actorOf(req).companyId)));
  app.post('/api/warehouses', { preHandler: app.guard('catalog:manage') }, async (req, reply) => {
    reply.status(201);
    return ok(await catalog.createWarehouse(actorOf(req), req.body));
  });
  app.patch('/api/warehouses/:id', { preHandler: app.guard('catalog:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await catalog.updateWarehouse(actorOf(req), id, req.body));
  });

  app.get('/api/suppliers', { preHandler: app.guard('incoming:view') }, async (req) => ok(await catalog.listSuppliers(actorOf(req).companyId)));
  app.post('/api/suppliers', { preHandler: app.guard('catalog:manage') }, async (req, reply) => {
    reply.status(201);
    return ok(await catalog.createSupplier(actorOf(req), req.body));
  });
  app.patch('/api/suppliers/:id', { preHandler: app.guard('catalog:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await catalog.updateSupplier(actorOf(req), id, req.body));
  });
}
