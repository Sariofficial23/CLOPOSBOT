import { cloposConnectSchema } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { AuditAction } from '../services/audit.service';
import { ok } from './helpers';

export default async function cloposRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { clopos, audit } = opts.services;

  /**
   * Connect Clopos: validates the credentials against POST /v2/auth and stores
   * them encrypted. The browser never talks to Clopos directly.
   */
  app.post('/api/clopos/connect', { preHandler: app.guard('clopos:manage'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const actor = actorOf(req);
    const input = parse(cloposConnectSchema, req.body);
    try {
      const status = await clopos.connect(actor.companyId, input);
      await audit.log({
        companyId: actor.companyId,
        userId: actor.id,
        action: AuditAction.CLOPOS_CONNECT,
        entity: 'CloposConnection',
        metadata: { brand: input.brand, venueId: status.venueId, ok: true, secretProvided: !!input.clientSecret },
        ip: actor.ip,
      });
      return ok(status);
    } catch (err) {
      await audit.log({
        companyId: actor.companyId,
        userId: actor.id,
        action: AuditAction.CLOPOS_CONNECT,
        entity: 'CloposConnection',
        metadata: { brand: input.brand, ok: false, error: err instanceof Error ? err.name : 'unknown' },
        ip: actor.ip,
      });
      throw err;
    }
  });

  /**
   * OAuth authorization-code callback.
   * TODO(clopos-verify): Clopos docs (API v2) document a credentials → token
   * exchange (POST /v2/auth) but no browser authorization/redirect flow was
   * found. This route stays a 501 until Clopos confirms the authorize URL,
   * token-exchange endpoint and parameters for CLOPOS_REDIRECT_URI.
   */
  app.get('/api/clopos/callback', async () => {
    throw new AppError(
      501,
      'CLOPOS_OAUTH_REDIRECT_NOT_SUPPORTED',
      'Clopos authorization-code redirect flow is not documented. Use POST /api/clopos/connect with the credentials issued by Clopos.',
    );
  });

  app.get('/api/clopos/status', { preHandler: app.guard('clopos:manage') }, async (req) => ok(await clopos.status(actorOf(req).companyId)));

  app.post('/api/clopos/test', { preHandler: app.guard('clopos:manage') }, async (req) => {
    const actor = actorOf(req);
    const result = await clopos.test(actor.companyId);
    await audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.CLOPOS_TEST,
      entity: 'CloposConnection',
      metadata: { ok: result.ok, checks: result.checks.map((c) => ({ name: c.name, ok: c.ok })) },
      ip: actor.ip,
    });
    return ok(result);
  });

  app.delete('/api/clopos/connection', { preHandler: app.guard('clopos:manage') }, async (req) => {
    const actor = actorOf(req);
    await clopos.disconnect(actor.companyId);
    await audit.log({ companyId: actor.companyId, userId: actor.id, action: AuditAction.CLOPOS_DISCONNECT, entity: 'CloposConnection', ip: actor.ip });
    return ok({ disconnected: true });
  });
}
