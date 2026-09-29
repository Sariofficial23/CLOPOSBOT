import { periodFromDate, salaryPayrollSchema } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { ok } from './helpers';

const idParams = z.object({ id: z.string().min(1).max(64) });

export default async function salaryRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { salary, reports } = opts.services;

  // ------------------------------------------------------------- employees
  app.get('/api/employees', { preHandler: app.guard('employees:view') }, async (req) => {
    const q = parse(z.object({ active: z.enum(['true', 'false']).optional() }), req.query);
    return ok(await salary.listEmployees(actorOf(req).companyId, { activeOnly: q.active === 'true' }));
  });

  app.post('/api/employees', { preHandler: app.guard('employees:manage') }, async (req, reply) => {
    reply.status(201);
    return ok(await salary.createEmployee(actorOf(req), req.body));
  });

  app.patch('/api/employees/:id', { preHandler: app.guard('employees:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await salary.updateEmployee(actorOf(req), id, req.body));
  });

  // ---------------------------------------------------------------- salary
  app.get('/api/salary', { preHandler: app.guard('salary:view') }, async (req) => {
    const actor = actorOf(req);
    const raw = req.query as { period?: string };
    const { timezone } = await reports.companyTimezone(actor.companyId);
    const { period } = parse(salaryPayrollSchema, { period: raw.period ?? periodFromDate(new Date(), timezone) });
    return ok(await salary.payroll(actor.companyId, period));
  });

  /** calculate (create or recalculate) a salary record */
  app.post('/api/salary', { preHandler: app.guard('salary:manage') }, async (req, reply) => {
    reply.status(201);
    return ok(await salary.calculate(actorOf(req), req.body));
  });

  app.post('/api/salary/calculate-all', { preHandler: app.guard('salary:manage') }, async (req) => {
    const { period } = parse(salaryPayrollSchema, req.body);
    return ok(await salary.calculateAll(actorOf(req), period));
  });

  app.patch('/api/salary/:id', { preHandler: app.guard('salary:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await salary.update(actorOf(req), id, req.body));
  });

  /** add bonus / penalty / advance */
  app.post('/api/salary/:id/adjust', { preHandler: app.guard('salary:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await salary.adjust(actorOf(req), id, req.body));
  });

  app.post('/api/salary/:id/pay', { preHandler: app.guard('salary:manage') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return ok(await salary.markPaid(actorOf(req), id));
  });
}
