import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/env';

/** Paths never written to logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.headers["x-token"]',
  'headers.authorization',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.clientSecret',
  '*.client_secret',
  '*.secret',
];

export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      // log method + path only: query strings could contain codes/tokens
      req(req) {
        return { method: req.method, url: req.url.split('?')[0], id: req.id };
      },
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

const SECRET_KEY = /pass(word)?|secret|token|authorization|api[_-]?key|credential|hash/i;

/** Deep-copy an object dropping any secret-looking keys (for audit metadata). */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}
