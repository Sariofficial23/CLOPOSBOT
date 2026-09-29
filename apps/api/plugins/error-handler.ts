import { CloposAuthError, CloposError, CloposNotSupportedError } from '@cpos/clopos';
import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ErrorBody, zodDetails } from '../lib/errors';

/**
 * Centralized error handling. Every error response has the shape
 *   { success: false, error: { code, message, details? } }
 * Stack traces and internal messages are never sent to clients.
 */
export function toErrorResponse(err: unknown, isProduction: boolean): { status: number; body: ErrorBody; log: boolean } {
  if (err instanceof ZodError) {
    return { status: 400, log: false, body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Некорректные данные', details: zodDetails(err) } } };
  }
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      log: err.statusCode >= 500,
      body: { success: false, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
    };
  }
  if (err instanceof CloposNotSupportedError) {
    return {
      status: 501,
      log: false,
      body: { success: false, error: { code: err.code, message: err.message, details: { operation: err.operation, required: err.required } } },
    };
  }
  if (err instanceof CloposAuthError) {
    return { status: 502, log: true, body: { success: false, error: { code: err.code, message: 'Clopos отклонил авторизацию. Проверьте подключение в Настройках.' } } };
  }
  if (err instanceof CloposError) {
    return { status: 502, log: true, body: { success: false, error: { code: err.code, message: 'Clopos временно недоступен или вернул ошибку' } } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    return { status: 404, log: false, body: { success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } } };
  }
  const fe = err as FastifyError;
  if (fe && typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    const code = fe.statusCode === 429 ? 'RATE_LIMITED' : fe.code && /^[A-Z_]+$/.test(fe.code) ? fe.code : 'BAD_REQUEST';
    const message = fe.statusCode === 429 ? 'Слишком много запросов, попробуйте позже' : isProduction ? 'Bad request' : fe.message;
    return { status: fe.statusCode, log: false, body: { success: false, error: { code, message } } };
  }
  return { status: 500, log: true, body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } };
}

export function registerErrorHandler(app: FastifyInstance, isProduction: boolean) {
  app.setErrorHandler((err, req, reply) => {
    const { status, body, log } = toErrorResponse(err, isProduction);
    if (log) req.log.error({ err, code: body.error.code }, 'request failed');
    reply.status(status).send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url.split('?')[0]} not found` } });
  });
}
