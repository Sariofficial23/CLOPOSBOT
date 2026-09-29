/**
 * Scheduled reports.
 *
 * Times are configured in the company timezone and evaluated in UTC by the
 * cron worker (Render Cron Jobs run in UTC). Each occurrence gets a
 * ReportDelivery row keyed by (scheduleId, occurrenceKey): overlapping or
 * repeated cron runs never send the same report twice (idempotent), failed
 * sends are retried on the next run up to MAX_ATTEMPTS.
 */
import {
  DEFAULT_SCHEDULES,
  hasPermission,
  isDue,
  latestOccurrence,
  occurrenceKey,
  rangeForOccurrence,
  type ReportScheduleInput,
  reportScheduleSchema,
  type Role,
  type ScheduleSpec,
} from '@cpos/shared';
import type { PrismaClient, ReportSchedule } from '@prisma/client';
import { isUniqueViolation } from '../lib/prisma';
import { AuditAction, type AuditService } from './audit.service';
import { formatReportText } from './report.format';
import type { ReportService } from './report.service';
import type { Actor } from './types';

export const MAX_ATTEMPTS = 3;
/** a PENDING delivery older than this is considered abandoned (crashed run) */
const STALE_PENDING_MS = 10 * 60_000;

export type MessageSender = (chatId: string, text: string) => Promise<void>;

export function serializeSchedule(s: ReportSchedule) {
  return {
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    hour: s.hour,
    minute: s.minute,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    reportPeriod: s.reportPeriod,
    extraChatId: s.extraChatId,
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toSpec(s: ReportSchedule): ScheduleSpec {
  return { type: s.type, hour: s.hour, minute: s.minute, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth, reportPeriod: s.reportPeriod };
}

export interface RunSummary {
  checked: number;
  due: number;
  sent: number;
  failed: number;
  skipped: number;
}

export class ScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reports: ReportService,
    private readonly audit: AuditService,
    private readonly maxLagMinutes = 180,
  ) {}

  /** Returns all three schedules, creating disabled defaults on first access. */
  async list(companyId: string) {
    const existing = await this.prisma.reportSchedule.findMany({ where: { companyId } });
    const missing = DEFAULT_SCHEDULES.filter((d) => !existing.some((e) => e.type === d.type));
    if (missing.length) {
      await this.prisma.reportSchedule.createMany({
        data: missing.map((d) => ({
          companyId,
          type: d.type,
          enabled: false,
          hour: d.hour,
          minute: d.minute,
          dayOfWeek: d.dayOfWeek ?? null,
          dayOfMonth: d.dayOfMonth ?? null,
          reportPeriod: d.reportPeriod,
        })),
        skipDuplicates: true,
      });
    }
    const all = await this.prisma.reportSchedule.findMany({ where: { companyId } });
    const order = { DAILY: 0, WEEKLY: 1, MONTHLY: 2 } as const;
    return all.sort((a, b) => order[a.type] - order[b.type]).map(serializeSchedule);
  }

  async upsert(actor: Actor, raw: unknown) {
    const input: ReportScheduleInput = reportScheduleSchema.parse(raw);
    const data = {
      enabled: input.enabled,
      hour: input.hour,
      minute: input.minute,
      dayOfWeek: input.type === 'WEEKLY' ? (input.dayOfWeek ?? null) : null,
      dayOfMonth: input.type === 'MONTHLY' ? (input.dayOfMonth ?? null) : null,
      reportPeriod: input.reportPeriod,
      extraChatId: input.extraChatId ?? null,
    };
    const s = await this.prisma.reportSchedule.upsert({
      where: { companyId_type: { companyId: actor.companyId, type: input.type } },
      create: { companyId: actor.companyId, type: input.type, ...data },
      update: data,
    });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.SCHEDULE_UPDATE,
      entity: 'ReportSchedule',
      entityId: s.id,
      metadata: { type: input.type, ...data },
      ip: actor.ip,
    });
    return serializeSchedule(s);
  }

  async toggle(actor: Actor, type: 'DAILY' | 'WEEKLY' | 'MONTHLY') {
    const list = await this.list(actor.companyId);
    const current = list.find((s) => s.type === type)!;
    return this.upsert(actor, { ...current, enabled: !current.enabled });
  }

  /** Telegram chat ids that receive a company's scheduled reports. */
  async recipients(companyId: string, extraChatId: string | null): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { companyId, active: true, telegramId: { not: null } },
      select: { telegramId: true, role: true },
    });
    const ids = users.filter((u) => hasPermission(u.role as Role, 'reports:view')).map((u) => u.telegramId as string);
    if (extraChatId) ids.push(extraChatId);
    return [...new Set(ids)];
  }

  /** Claim an occurrence. Returns the delivery id, or null if another run owns/finished it. */
  private async claim(scheduleId: string, key: string, now: Date): Promise<string | null> {
    try {
      const d = await this.prisma.reportDelivery.create({ data: { scheduleId, occurrenceKey: key, status: 'PENDING', attempts: 1 } });
      return d.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const d = await this.prisma.reportDelivery.findUnique({ where: { scheduleId_occurrenceKey: { scheduleId, occurrenceKey: key } } });
    if (!d || d.status === 'SENT' || d.attempts >= MAX_ATTEMPTS) return null;
    if (d.status === 'PENDING' && now.getTime() - d.updatedAt.getTime() < STALE_PENDING_MS) return null;
    // optimistic claim: only one runner can bump attempts from this value
    const res = await this.prisma.reportDelivery.updateMany({
      where: { id: d.id, attempts: d.attempts, status: d.status },
      data: { status: 'PENDING', attempts: d.attempts + 1 },
    });
    return res.count === 1 ? d.id : null;
  }

  async runDue(send: MessageSender, now: Date = new Date(), log: (msg: string, extra?: object) => void = () => {}): Promise<RunSummary> {
    const schedules = await this.prisma.reportSchedule.findMany({ where: { enabled: true }, include: { company: true } });
    const summary: RunSummary = { checked: schedules.length, due: 0, sent: 0, failed: 0, skipped: 0 };
    for (const s of schedules) {
      const tz = s.company.timezone;
      const spec = toSpec(s);
      let occ;
      try {
        occ = latestOccurrence(spec, tz, now);
      } catch (err) {
        log('invalid schedule', { scheduleId: s.id, error: (err as Error).message });
        continue;
      }
      if (!isDue(occ, now, this.maxLagMinutes, s.updatedAt)) continue;
      summary.due++;
      const key = occurrenceKey(spec, occ);
      const deliveryId = await this.claim(s.id, key, now);
      if (!deliveryId) {
        summary.skipped++;
        continue;
      }
      try {
        const range = rangeForOccurrence(spec, occ, tz);
        const report = await this.reports.build(s.companyId, range);
        const text = formatReportText(report, s.company.currency);
        const chats = await this.recipients(s.companyId, s.extraChatId);
        if (chats.length === 0) throw new Error('No recipients with Telegram ID and reports permission');
        let delivered = 0;
        const errors: string[] = [];
        for (const chatId of chats) {
          try {
            await send(chatId, text);
            delivered++;
          } catch (err) {
            errors.push(err instanceof Error ? err.message.slice(0, 200) : 'send failed');
          }
        }
        if (delivered === 0) throw new Error(errors.join('; ') || 'send failed');
        await this.prisma.reportDelivery.update({
          where: { id: deliveryId },
          data: { status: 'SENT', sentAt: new Date(), error: errors.length ? errors.join('; ').slice(0, 1000) : null },
        });
        await this.audit.log({
          companyId: s.companyId,
          action: AuditAction.REPORT_SCHEDULED_SENT,
          entity: 'ReportSchedule',
          entityId: s.id,
          metadata: { occurrence: key, recipients: chats.length, delivered, preset: range.preset },
        });
        summary.sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 1000) : 'unknown error';
        await this.prisma.reportDelivery.update({ where: { id: deliveryId }, data: { status: 'FAILED', error: message } });
        log('scheduled report failed', { scheduleId: s.id, occurrence: key, error: message });
        summary.failed++;
      }
    }
    return summary;
  }
}
