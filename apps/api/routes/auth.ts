import type { FastifyInstance } from 'fastify';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

export default async function authRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { auth, company } = opts.services;
  const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/api/auth/login', { config: strict }, async (req) => {
    const user = await auth.login(req.body, req.ip);
    return ok({ token: app.signToken({ sub: user.id, cid: user.companyId, role: user.role }), user });
  });

  app.post('/api/auth/telegram', { config: strict }, async (req) => {
    const user = await auth.loginWithTelegram(req.body, req.ip);
    return ok({ token: app.signToken({ sub: user.id, cid: user.companyId, role: user.role }), user });
  });

  app.get('/api/auth/me', { preHandler: app.guard() }, async (req) => {
    const actor = actorOf(req);
    return ok({
      user: { id: actor.id, name: actor.name, role: actor.role, companyId: actor.companyId, telegramId: actor.telegramId ?? null },
      company: await company.get(actor.companyId),
    });
  });
}
