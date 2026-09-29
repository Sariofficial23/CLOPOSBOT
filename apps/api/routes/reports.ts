import type { ReportPreset } from '@cpos/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors';
import { actorOf } from '../plugins/auth';
import type { Services } from '../services';
import { formatReportText } from '../services/report.format';
import { ok } from './helpers';

const query = z.object({
  /** previous full day/week/month instead of the current one */
  previous: z.enum(['true', 'false']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['json', 'text']).optional(),
});

const PRESETS: Record<'daily' | 'weekly' | 'monthly', [ReportPreset, ReportPreset]> = {
  daily: ['today', 'yesterday'],
  weekly: ['week', 'last_week'],
  monthly: ['month', 'last_month'],
};

export default async function reportRoutes(app: FastifyInstance, opts: { services: Services }) {
  const { reports } = opts.services;

  for (const kind of ['daily', 'weekly', 'monthly'] as const) {
    app.get(`/api/reports/${kind}`, { preHandler: app.guard('reports:view') }, async (req) => {
      const actor = actorOf(req);
      const q = parse(query, req.query);
      const [current, previous] = PRESETS[kind];
      const range = await reports.resolveRange(actor.companyId, { preset: q.previous === 'true' ? previous : current, from: q.from, to: q.to }, current);
      const report = await reports.generate(actor, range, 'api');
      if (q.format === 'text') {
        const { currency } = await reports.companyTimezone(actor.companyId);
        return ok({ text: formatReportText(report, currency) });
      }
      return ok(report);
    });
  }
}
