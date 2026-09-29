import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, auth, createTestContext, HAS_DB, type TestContext } from './helpers';

describe.skipIf(!HAS_DB)('API routes', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(async () => {
    await t?.app.close();
  });

  const get = (url: string, token?: string) => t.app.inject({ method: 'GET', url, headers: token ? auth(token) : {} });
  const send = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    t.app.inject({ method, url, headers: { ...auth(token), ...headers }, payload: payload as object });

  describe('health & security headers', () => {
    it('GET /api/health', async () => {
      const r = await get('/api/health');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ success: true, data: { status: 'ok', db: 'ok', cloposAdapter: 'mock' } });
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-ratelimit-limit']).toBeUndefined(); // health is not rate limited
    });

    it('CORS allows only FRONTEND_URL', async () => {
      const ok = await t.app.inject({ method: 'OPTIONS', url: '/api/dashboard', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } });
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      const bad = await t.app.inject({ method: 'OPTIONS', url: '/api/dashboard', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('unknown routes use the error envelope', async () => {
      const r = await get('/api/nope');
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });
  });

  describe('authentication', () => {
    it('logs in with email/password and returns a JWT', async () => {
      const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.data.token).toMatch(/^ey/);
      expect(body.data.user).toMatchObject({ email: ADMIN.email, role: 'SUPER_ADMIN' });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      const me = await get('/api/auth/me', body.data.token);
      expect(me.json().data.user.role).toBe('SUPER_ADMIN');
    });

    it('rejects a wrong password and audits it without storing the password', async () => {
      const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN.email, password: 'WrongPassword1' } });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
      const log = await t.prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGIN_FAILED' }, orderBy: { createdAt: 'desc' } });
      expect(log).toBeTruthy();
      expect(JSON.stringify(log!.metadata)).not.toContain('WrongPassword1');
    });

    it('EMPLOYEE cannot use the dashboard', async () => {
      const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'employee.demo@example.com', password: 'DemoPassword123!' } });
      expect(r.statusCode).toBe(403);
    });

    it('rejects missing, forged and deactivated tokens', async () => {
      expect((await get('/api/dashboard')).statusCode).toBe(401);
      expect((await get('/api/dashboard', 'not-a-jwt')).statusCode).toBe(401);
      await t.prisma.user.update({ where: { id: t.userIds.MANAGER }, data: { active: false } });
      expect((await get('/api/sales', t.tokens.MANAGER)).statusCode).toBe(401);
      await t.prisma.user.update({ where: { id: t.userIds.MANAGER }, data: { active: true } });
    });

    it('validates login input', async () => {
      const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nope', password: '1' } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('role based authorization', () => {
    const matrix: [string, string, Record<string, number>][] = [
      ['GET', '/api/dashboard', { SUPER_ADMIN: 200, ADMIN: 200, MANAGER: 200, ACCOUNTANT: 200, EMPLOYEE: 403 }],
      ['GET', '/api/sales', { ADMIN: 200, MANAGER: 200, ACCOUNTANT: 403, EMPLOYEE: 403 }],
      ['GET', '/api/inventory', { MANAGER: 200, ACCOUNTANT: 403, EMPLOYEE: 200 }],
      ['GET', '/api/salary', { ADMIN: 200, ACCOUNTANT: 200, MANAGER: 403, EMPLOYEE: 403 }],
      ['GET', '/api/employees', { ACCOUNTANT: 200, MANAGER: 403 }],
      ['GET', '/api/reports/daily', { MANAGER: 200, ACCOUNTANT: 200, EMPLOYEE: 403 }],
      ['GET', '/api/audit', { SUPER_ADMIN: 200, ADMIN: 200, MANAGER: 403, ACCOUNTANT: 403 }],
      ['GET', '/api/users', { ADMIN: 200, MANAGER: 403 }],
      ['GET', '/api/clopos/status', { ADMIN: 200, ACCOUNTANT: 403 }],
    ];
    for (const [method, url, expected] of matrix) {
      for (const [role, status] of Object.entries(expected)) {
        it(`${role} ${method} ${url} → ${status}`, async () => {
          const r = await get(url, t.tokens[role as keyof typeof t.tokens]);
          expect(r.statusCode).toBe(status);
          if (status === 403) expect(r.json()).toEqual({ success: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
        });
      }
    }

    it('only SUPER_ADMIN may delete a company', async () => {
      const other = await t.prisma.company.create({ data: { name: 'To delete' } });
      expect((await send('DELETE', `/api/companies/${other.id}`, t.tokens.ADMIN)).statusCode).toBe(403);
      expect((await send('DELETE', `/api/companies/${other.id}`, t.tokens.SUPER_ADMIN)).statusCode).toBe(200);
      expect(await t.prisma.company.findUnique({ where: { id: other.id } })).toBeNull();
    });

    it('ADMIN cannot create a SUPER_ADMIN', async () => {
      const r = await send('POST', '/api/users', t.tokens.ADMIN, { name: 'X', role: 'SUPER_ADMIN', telegramId: '5550001' });
      expect(r.statusCode).toBe(403);
    });
  });

  describe('dashboard, sales, reports', () => {
    it('GET /api/dashboard returns cards and charts', async () => {
      const r = await get('/api/dashboard?preset=week', t.tokens.MANAGER);
      const d = r.json().data;
      expect(d.source).toBe('mock');
      expect(d.cards).toHaveProperty('sales');
      expect(d.cards).toHaveProperty('orders');
      expect(d.cards).toHaveProperty('profit');
      expect(Array.isArray(d.charts.salesByDay)).toBe(true);
      expect(Array.isArray(d.charts.paymentMethods)).toBe(true);
    });

    it('custom date ranges are validated', async () => {
      expect((await get('/api/sales?from=2026-09-10&to=2026-09-01', t.tokens.MANAGER)).statusCode).toBe(400);
      expect((await get('/api/sales?from=bad&to=2026-09-01', t.tokens.MANAGER)).statusCode).toBe(400);
      expect((await get('/api/sales?from=2026-09-01', t.tokens.MANAGER)).statusCode).toBe(400);
      expect((await get('/api/sales?from=2025-01-01&to=2026-09-01', t.tokens.MANAGER)).statusCode).toBe(400);
    });

    it('reports: daily/weekly/monthly + text format, audit logged', async () => {
      const before = await t.prisma.auditLog.count({ where: { action: 'REPORT_GENERATE', userId: t.userIds.ACCOUNTANT } });
      for (const kind of ['daily', 'weekly', 'monthly']) {
        const r = await get(`/api/reports/${kind}`, t.tokens.ACCOUNTANT);
        expect(r.statusCode).toBe(200);
        expect(r.json().data.sales).toHaveProperty('orders');
      }
      const text = await get('/api/reports/daily?previous=true&format=text', t.tokens.ACCOUNTANT);
      expect(text.json().data.text).toContain('📊 ОТЧЁТ ЗА ВЧЕРА');
      const logs = await t.prisma.auditLog.count({ where: { action: 'REPORT_GENERATE', userId: t.userIds.ACCOUNTANT } });
      expect(logs - before).toBe(4);
    });
  });

  describe('incoming', () => {
    const valid = {
      storageId: 'mock-s-1',
      storageName: 'Основной склад',
      supplierId: 'mock-sup-1',
      supplierName: 'ABC Supplier',
      items: [{ productId: 'mock-p-1', productName: 'Coca-Cola 0.5', quantity: 50, price: 8000 }],
    };

    it('creates an incoming, syncs to (mock) Clopos, audits it', async () => {
      const r = await send('POST', '/api/incoming', t.tokens.MANAGER, valid);
      expect(r.statusCode).toBe(201);
      const inc = r.json().data.incoming;
      expect(inc).toMatchObject({ status: 'SYNCED', total: 400_000, source: 'web' });
      expect(inc.cloposOperationId).toMatch(/^mock-inc-/);
      const audit = await t.prisma.auditLog.findFirst({ where: { action: 'INCOMING_CREATE', entityId: inc.id } });
      expect(audit?.userId).toBe(t.userIds.MANAGER);
      const list = await get('/api/incoming', t.tokens.ACCOUNTANT);
      expect(list.json().data.items[0].id).toBe(inc.id);
    });

    it('is idempotent with Idempotency-Key', async () => {
      const h = { 'idempotency-key': 'retry-key-123456' };
      const a = await send('POST', '/api/incoming', t.tokens.MANAGER, valid, h);
      const b = await send('POST', '/api/incoming', t.tokens.MANAGER, valid, h);
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(200);
      expect(b.json().data).toMatchObject({ duplicate: true, incoming: { id: a.json().data.incoming.id } });
    });

    it('rejects invalid payloads (schema)', async () => {
      const r = await send('POST', '/api/incoming', t.tokens.MANAGER, { ...valid, items: [{ ...valid.items[0], quantity: -1 }] });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.details[0].path).toBe('items.0.quantity');
    });

    it('rejects unknown storage/product (catalogue check)', async () => {
      const r = await send('POST', '/api/incoming', t.tokens.MANAGER, { ...valid, storageId: 'nope', items: [{ ...valid.items[0], productId: 'ghost' }] });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('INCOMING_INVALID');
    });

    it('options endpoint lists pickers', async () => {
      const r = await get('/api/incoming/options', t.tokens.EMPLOYEE);
      expect(r.json().data).toMatchObject({ available: true, mode: 'mock' });
    });
  });

  describe('employees & salary', () => {
    it('creates and updates an employee (audited, tenant-isolated)', async () => {
      const c = await send('POST', '/api/employees', t.tokens.ADMIN, { name: 'Dilnoza', position: 'Кассир', baseSalary: 4_000_000 });
      expect(c.statusCode).toBe(201);
      const id = c.json().data.id;
      const u = await send('PATCH', `/api/employees/${id}`, t.tokens.ADMIN, { baseSalary: 4_200_000 });
      expect(u.json().data.baseSalary).toBe(4_200_000);
      const log = await t.prisma.auditLog.findFirst({ where: { action: 'EMPLOYEE_UPDATE', entityId: id } });
      expect(log?.metadata).toMatchObject({ changes: { baseSalary: { from: 4_000_000, to: 4_200_000 } } });

      const other = await t.prisma.company.create({ data: { name: 'Other' } });
      const foreign = await t.prisma.employee.create({ data: { companyId: other.id, name: 'Foreign', position: 'x', baseSalary: 1 } });
      expect((await send('PATCH', `/api/employees/${foreign.id}`, t.tokens.ADMIN, { name: 'Hacked' })).statusCode).toBe(404);
    });

    it('ACCOUNTANT cannot add employees but manages salary', async () => {
      expect((await send('POST', '/api/employees', t.tokens.ACCOUNTANT, { name: 'X', position: 'Y', baseSalary: 1 })).statusCode).toBe(403);
    });

    it('calculates salary: total = base + bonus - penalty - advance', async () => {
      const emp = t.employees.find((e) => e.name === 'Madina')!;
      const r = await send('POST', '/api/salary', t.tokens.ACCOUNTANT, { employeeId: emp.id, period: t.period, bonus: 300_000, penalty: 100_000, advance: 1_000_000 });
      expect(r.statusCode).toBe(201);
      expect(r.json().data).toMatchObject({ baseSalary: 4_500_000, total: 3_700_000, status: 'DRAFT' });
      const id = r.json().data.id;

      const adj = await send('POST', `/api/salary/${id}/adjust`, t.tokens.ACCOUNTANT, { kind: 'bonus', amount: 200_000 });
      expect(adj.json().data).toMatchObject({ bonus: 500_000, total: 3_900_000 });

      // recalculation keeps existing components
      const re = await send('POST', '/api/salary', t.tokens.ACCOUNTANT, { employeeId: emp.id, period: t.period, penalty: 0 });
      expect(re.json().data).toMatchObject({ bonus: 500_000, penalty: 0, advance: 1_000_000, total: 4_000_000 });

      const pay = await send('POST', `/api/salary/${id}/pay`, t.tokens.ACCOUNTANT);
      expect(pay.json().data.status).toBe('PAID');
      expect(pay.json().data.paidAt).toBeTruthy();

      // paid records are immutable
      expect((await send('POST', `/api/salary/${id}/pay`, t.tokens.ACCOUNTANT)).statusCode).toBe(409);
      expect((await send('PATCH', `/api/salary/${id}`, t.tokens.ACCOUNTANT, { bonus: 1 })).statusCode).toBe(409);
      expect((await send('POST', `/api/salary/${id}/adjust`, t.tokens.ACCOUNTANT, { kind: 'penalty', amount: 1 })).statusCode).toBe(409);

      const actions = (await t.prisma.auditLog.findMany({ where: { entityId: id } })).map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['SALARY_CALCULATE', 'SALARY_ADJUST', 'SALARY_PAY']));
    });

    it('payroll lists records, missing employees and totals', async () => {
      const r = await get(`/api/salary?period=${t.period}`, t.tokens.ADMIN);
      const d = r.json().data;
      expect(d.items.length).toBeGreaterThanOrEqual(2);
      expect(d.totals.total).toBe(d.items.reduce((a: number, i: { total: number }) => a + i.total, 0));
      expect((await get('/api/salary?period=2026-13', t.tokens.ADMIN)).statusCode).toBe(400);
    });

    it('calculate-all creates drafts for the rest', async () => {
      const r = await send('POST', '/api/salary/calculate-all', t.tokens.ACCOUNTANT, { period: t.period });
      expect(r.json().data.created).toBeGreaterThanOrEqual(1);
    });
  });

  describe('settings, schedules, users, audit', () => {
    it('updates settings with timezone validation', async () => {
      expect((await send('PATCH', '/api/settings', t.tokens.ADMIN, { timezone: 'Mars/Base' })).statusCode).toBe(400);
      const r = await send('PATCH', '/api/settings', t.tokens.ADMIN, { timezone: 'Asia/Tashkent', name: 'Plov House' });
      expect(r.json().data.name).toBe('Plov House');
      expect(await t.prisma.auditLog.count({ where: { action: 'SETTINGS_UPDATE' } })).toBe(1);
    });

    it('schedules default to daily 23:00, weekly Mon 09:00, monthly 1st 09:00', async () => {
      const r = await get('/api/report-schedules', t.tokens.ADMIN);
      const s = r.json().data;
      expect(s.map((x: { type: string }) => x.type)).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
      expect(s[0]).toMatchObject({ hour: 23, minute: 0 });
      expect(s[1]).toMatchObject({ hour: 9, dayOfWeek: 1, reportPeriod: 'PREVIOUS' });
      expect(s[2]).toMatchObject({ hour: 9, dayOfMonth: 1 });
      const bad = await send('PUT', '/api/report-schedules', t.tokens.ADMIN, { type: 'WEEKLY', enabled: true, hour: 9, minute: 0, reportPeriod: 'PREVIOUS' });
      expect(bad.statusCode).toBe(400);
      const ok = await send('PUT', '/api/report-schedules', t.tokens.ADMIN, { type: 'DAILY', enabled: true, hour: 22, minute: 30, reportPeriod: 'CURRENT' });
      expect(ok.json().data).toMatchObject({ enabled: true, hour: 22, minute: 30 });
    });

    it('creates users with telegram id; duplicate telegram id → 409', async () => {
      const a = await send('POST', '/api/users', t.tokens.ADMIN, { name: 'Bot user', role: 'MANAGER', telegramId: '777000' });
      expect(a.statusCode).toBe(201);
      const b = await send('POST', '/api/users', t.tokens.ADMIN, { name: 'Dup', role: 'MANAGER', telegramId: '777000' });
      expect(b.statusCode).toBe(409);
    });

    it('audit log is paginated and never contains secrets', async () => {
      const r = await get('/api/audit?pageSize=100', t.tokens.ADMIN);
      const body = r.json().data;
      expect(body.total).toBeGreaterThan(5);
      const dump = JSON.stringify(body);
      expect(dump).not.toMatch(/RootPassword123|DemoPassword123|passwordHash/);
    });
  });

  describe('clopos', () => {
    it('connect is refused in mock mode; callback is 501 (documented TODO)', async () => {
      const r = await send('POST', '/api/clopos/connect', t.tokens.ADMIN, { brand: 'demo', clientId: 'a', clientSecret: 'b', integratorId: 'c' });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe('CLOPOS_MOCK_MODE');
      const cb = await get('/api/clopos/callback?code=abc');
      expect(cb.statusCode).toBe(501);
    });

    it('status/test work for mock', async () => {
      expect((await get('/api/clopos/status', t.tokens.ADMIN)).json().data).toMatchObject({ mode: 'mock', connected: true });
      expect((await send('POST', '/api/clopos/test', t.tokens.ADMIN)).json().data.ok).toBe(true);
    });
  });

  describe('telegram webhook', () => {
    it('is disabled unless webhook mode is configured', async () => {
      const r = await t.app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: {} });
      expect(r.statusCode).toBe(404);
    });
  });
});
