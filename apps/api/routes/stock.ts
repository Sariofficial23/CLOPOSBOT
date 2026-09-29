import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors';
import { MAX_FILE_BYTES } from '../lib/stock-parser';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

const idParams = z.object({ id: z.string().min(1).max(64) });
const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  // base64 of the .xlsx/.csv file (≤ 5 MB decoded)
  contentBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16),
});

/** Stock snapshots imported from Clopos Excel/CSV exports. */
export default async function stockRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { stockImport } = opts.services;

  app.get('/api/stock', { preHandler: app.guard('stock:view') }, async (req) => ok(await stockImport.current(actorOf(req).companyId)));

  app.post('/api/stock/import', { preHandler: app.guard('catalog:manage'), bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const body = parse(uploadSchema, req.body);
    const buffer = Buffer.from(body.contentBase64, 'base64');
    reply.status(201);
    return ok(await stockImport.createDraft(actorOf(req), buffer, body.fileName, 'web'));
  });

  app.post('/api/stock/import/:id/confirm', { preHandler: app.guard('catalog:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await stockImport.confirm(actorOf(req), id));
  });

  app.delete('/api/stock/import/:id', { preHandler: app.guard('catalog:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    await stockImport.discard(actorOf(req), id);
    return ok({ discarded: true });
  });
}
