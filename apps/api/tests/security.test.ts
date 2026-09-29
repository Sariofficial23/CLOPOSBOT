import { createHash, createHmac } from 'node:crypto';
import { CloposNotSupportedError } from '@cpos/clopos';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../config/env';
import { Encryptor, safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { sanitize } from '../lib/logger';
import { verifyTelegramLogin } from '../lib/telegram-auth';
import { toErrorResponse } from '../plugins/error-handler';

describe('Encryptor', () => {
  const enc = new Encryptor(Buffer.alloc(32, 1).toString('base64'));
  it('round-trips and uses a random IV', () => {
    const a = enc.encrypt('secret-token');
    expect(a).not.toContain('secret-token');
    expect(enc.encrypt('secret-token')).not.toBe(a);
    expect(enc.decrypt(a)).toBe('secret-token');
  });
  it('detects tampering', () => {
    const parts = enc.encrypt('x').split('.');
    parts[3] = Buffer.from('y').toString('base64url');
    expect(() => enc.decrypt(parts.join('.'))).toThrow();
  });
  it('rejects short keys', () => expect(() => new Encryptor('short-key-too-short')).toThrow());
  it('accepts any long random string (e.g. Render "Generate")', () => {
    const e = new Encryptor('aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY');
    expect(e.decrypt(e.encrypt('ok'))).toBe('ok');
  });
  it('accepts hex keys', () => expect(() => new Encryptor('ab'.repeat(32))).not.toThrow());
});

describe('safeEqual', () => {
  it('compares', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('verifyTelegramLogin', () => {
  const token = '123456:TEST';
  const sign = (data: Record<string, string | number>) => {
    const dcs = Object.entries(data).map(([k, v]) => `${k}=${v}`).sort().join('\n');
    return createHmac('sha256', createHash('sha256').update(token).digest()).update(dcs).digest('hex');
  };
  const now = new Date('2026-09-29T10:00:00Z');
  const data = { id: 42, first_name: 'Aziz', auth_date: Math.floor(now.getTime() / 1000) - 60 };

  it('accepts a valid signature', () => expect(verifyTelegramLogin({ ...data, hash: sign(data) }, token, now)).toBe(true));
  it('rejects a forged payload', () => expect(verifyTelegramLogin({ ...data, id: 43, hash: sign(data) }, token, now)).toBe(false));
  it('rejects expired logins', () => {
    const old = { ...data, auth_date: data.auth_date - 2 * 86_400 };
    expect(verifyTelegramLogin({ ...old, hash: sign(old) }, token, now)).toBe(false);
  });
});

describe('sanitize (audit metadata)', () => {
  it('drops secrets at any depth', () => {
    const out = sanitize({ email: 'a@b.c', password: 'p', nested: { clientSecret: 's', accessToken: 't', ok: 1 }, list: [{ token: 'x' }] });
    expect(out).toEqual({ email: 'a@b.c', password: '[REDACTED]', nested: { clientSecret: '[REDACTED]', accessToken: '[REDACTED]', ok: 1 }, list: [{ token: '[REDACTED]' }] });
  });
});

describe('error responses', () => {
  it('never leaks internals of unknown errors', () => {
    const r = toErrorResponse(new Error('connection string postgres://user:pw@host'), true);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('postgres');
    expect(r.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  it('maps validation, app and Clopos errors', () => {
    const zerr = z.object({ a: z.string() }).safeParse({}).error!;
    expect(toErrorResponse(zerr, true).body.error.code).toBe('VALIDATION_ERROR');
    expect(toErrorResponse(new AppError(409, 'X', 'conflict'), true).status).toBe(409);
    const nse = toErrorResponse(new CloposNotSupportedError('getStock', 'GET stock'), true);
    expect(nse.status).toBe(501);
    expect(nse.body.error.code).toBe('CLOPOS_NOT_SUPPORTED');
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };
  it('requires PORT and forbids the mock adapter in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CLOPOS_ADAPTER: 'mock' })).toThrow(/PORT[\s\S]*CLOPOS_ADAPTER/);
  });
  it('requires a webhook secret for production webhook mode', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PORT: '10000', TELEGRAM_BOT_TOKEN: '1:a' })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ ...base, JWT_SECRET: 'too-short-secret-value' });
    } catch (err) {
      expect(String(err)).not.toContain('too-short-secret-value');
    }
  });
  it('the cron worker needs neither PORT nor a webhook secret', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:a' }, 'worker')).not.toThrow();
  });
  it('uses process.env.PORT and 0.0.0.0', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', PORT: '10000' });
    expect(c.port).toBe(10000);
    expect(c.HOST).toBe('0.0.0.0');
  });
});
