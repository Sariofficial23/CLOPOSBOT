import { DateTime } from 'luxon';
import { assertTimezone, type ResolvedRange, resolvePreset } from './periods';

export type ScheduleType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ReportPeriodMode = 'CURRENT' | 'PREVIOUS';

export interface ScheduleSpec {
  type: ScheduleType;
  /** 0-23, company local time */
  hour: number;
  /** 0-59, company local time */
  minute: number;
  /** 1 = Monday … 7 = Sunday (WEEKLY only) */
  dayOfWeek?: number | null;
  /** 1-28 (MONTHLY only; capped at 28 so every month has the day) */
  dayOfMonth?: number | null;
  /** which period the report covers relative to the occurrence */
  reportPeriod: ReportPeriodMode;
}

export const DEFAULT_SCHEDULES: ScheduleSpec[] = [
  { type: 'DAILY', hour: 23, minute: 0, reportPeriod: 'CURRENT' },
  { type: 'WEEKLY', hour: 9, minute: 0, dayOfWeek: 1, reportPeriod: 'PREVIOUS' },
  { type: 'MONTHLY', hour: 9, minute: 0, dayOfMonth: 1, reportPeriod: 'PREVIOUS' },
];

export function validateSchedule(s: ScheduleSpec): void {
  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) throw new RangeError('hour must be 0-23');
  if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) throw new RangeError('minute must be 0-59');
  if (s.type === 'WEEKLY' && (!s.dayOfWeek || s.dayOfWeek < 1 || s.dayOfWeek > 7)) {
    throw new RangeError('dayOfWeek must be 1-7 for WEEKLY');
  }
  if (s.type === 'MONTHLY' && (!s.dayOfMonth || s.dayOfMonth < 1 || s.dayOfMonth > 28)) {
    throw new RangeError('dayOfMonth must be 1-28 for MONTHLY');
  }
}

/**
 * The most recent scheduled occurrence at or before `now`, as a local DateTime.
 * All inputs are in company local time; the result can be converted to UTC.
 */
export function latestOccurrence(s: ScheduleSpec, timezone: string, now: Date = new Date()): DateTime {
  validateSchedule(s);
  assertTimezone(timezone);
  const local = DateTime.fromJSDate(now).setZone(timezone);
  const at = (d: DateTime) => d.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });

  if (s.type === 'DAILY') {
    const candidate = at(local);
    return candidate <= local ? candidate : at(local.minus({ days: 1 }));
  }
  if (s.type === 'WEEKLY') {
    const dow = s.dayOfWeek as number;
    let candidate = at(local.set({ weekday: dow as 1 | 2 | 3 | 4 | 5 | 6 | 7 }));
    if (candidate > local) candidate = candidate.minus({ weeks: 1 });
    return candidate;
  }
  const dom = s.dayOfMonth as number;
  let candidate = at(local.set({ day: dom }));
  if (candidate > local) candidate = at(local.minus({ months: 1 }).set({ day: dom }));
  return candidate;
}

/** Stable key identifying one occurrence; used for idempotent delivery. */
export function occurrenceKey(s: ScheduleSpec, occurrence: DateTime): string {
  return `${s.type}:${occurrence.toFormat("yyyy-MM-dd'T'HH:mm")}`;
}

/** Report range covered by an occurrence. */
export function rangeForOccurrence(s: ScheduleSpec, occurrence: DateTime, timezone: string): ResolvedRange {
  // resolvePreset works relative to "now"; pass a moment inside the occurrence day.
  const anchor = occurrence.toJSDate();
  if (s.type === 'DAILY') return resolvePreset(s.reportPeriod === 'CURRENT' ? 'today' : 'yesterday', timezone, anchor);
  if (s.type === 'WEEKLY') return resolvePreset(s.reportPeriod === 'CURRENT' ? 'week' : 'last_week', timezone, anchor);
  return resolvePreset(s.reportPeriod === 'CURRENT' ? 'month' : 'last_month', timezone, anchor);
}

/**
 * Whether an occurrence is still "fresh" enough to deliver. Prevents sending a
 * flood of stale reports after downtime, or right after a schedule is created.
 */
export function isDue(occurrence: DateTime, now: Date, maxLagMinutes: number, notBefore?: Date): boolean {
  const occ = occurrence.toJSDate().getTime();
  if (notBefore && occ < notBefore.getTime()) return false;
  const lag = now.getTime() - occ;
  return lag >= 0 && lag <= maxLagMinutes * 60_000;
}
