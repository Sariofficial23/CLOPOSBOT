import fastifyJwt from '@fastify/jwt';
import { hasPermission, type Permission, type Role } from '@cpos/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/env';
import { Errors } from '../lib/errors';
import type { Services } from '../services';
import type { Actor } from '../services/types';

export interface JwtPayload {
  sub: string;
  cid: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid JWT and ALL listed permissions */
    guard: (...permissions: Permission[]) => preHandlerAsyncHookHandler;
    signToken: (payload: JwtPayload) => string;
  }
}

/** Current actor or throw 401 (for handlers behind `guard`). */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw Errors.unauthorized();
  return req.actor;
}

async function authPlugin(app: FastifyInstance, opts: { config: AppConfig; services: Services }) {
  await app.register(fastifyJwt, {
    secret: opts.config.JWT_SECRET,
    sign: { expiresIn: opts.config.JWT_EXPIRES_IN, algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorateRequest('actor', null);
  app.decorate('signToken', (payload: JwtPayload) => app.jwt.sign(payload));

  app.decorate('guard', (...permissions: Permission[]) => {
    return async (req: FastifyRequest, _reply: FastifyReply) => {
      let payload: JwtPayload;
      try {
        payload = await req.jwtVerify<JwtPayload>();
      } catch {
        throw Errors.unauthorized('Сессия истекла или токен недействителен');
      }
      // re-read the user: deactivation / role change takes effect immediately
      const actor = await opts.services.auth.resolveActor(payload.sub, payload.cid);
      if (!actor) throw Errors.unauthorized('Пользователь не найден или отключён');
      const missing = permissions.filter((p) => !hasPermission(actor.role, p));
      if (missing.length) throw Errors.forbidden();
      req.actor = { ...actor, ip: req.ip };
    };
  });
}

export default fp(authPlugin, { name: 'auth' });
