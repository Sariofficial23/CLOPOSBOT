import { DateTime } from 'luxon';

export type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'last_week' | 'last_month';

export interface DateRange {
  /** inclusive, UTC instant */
  from: Date;
  /** exclusive, UTC instant */
  to: Date;
}

export interface ResolvedRange extends DateRange {
  preset: ReportPreset | 'custom';
  timezone: string;
  /** human readable (Russian) label */
  label: string;
}

export function assertTimezone(timezone: string): void {
  if (!DateTime.local().setZone(timezone).isValid) {
    throw new RangeError(`Unknown timezone: ${timezone}`);
  }
}

function fmt(dt: DateTime): string {
  return dt.toFormat('dd.MM.yyyy');
}

/**
 * Resolve a preset into a [from, to) UTC range computed in the company timezone.
 *  - today/yesterday: calendar day
 *  - week: current ISO week (Monday) up to the end of today
 *  - month: current calendar month up to the end of today
 *  - last_week / last_month: previous full week / month
 */
export function resolvePreset(preset: ReportPreset, timezone: string, now: Date = new Date()): ResolvedRange {
  assertTimezone(timezone);
  const local = DateTime.fromJSDate(now).setZone(timezone);
  const today = local.startOf('day');
  let from: DateTime;
  let to: DateTime;
  let label: string;
  switch (preset) {
    case 'today':
      from = today;
      to = today.plus({ days: 1 });
      label = `за сегодня (${fmt(from)})`;
      break;
    case 'yesterday':
      from = today.minus({ days: 1 });
      to = today;
      label = `за вчера (${fmt(from)})`;
      break;
    case 'week':
      from = local.startOf('week');
      to = today.plus({ days: 1 });
      label = `за неделю (${fmt(from)} – ${fmt(today)})`;
      break;
    case 'month':
      from = local.startOf('month');
      to = today.plus({ days: 1 });
      label = `за месяц (${fmt(from)} – ${fmt(today)})`;
      break;
    case 'last_week':
      from = local.startOf('week').minus({ weeks: 1 });
      to = local.startOf('week');
      label = `за неделю (${fmt(from)} – ${fmt(to.minus({ days: 1 }))})`;
      break;
    case 'last_month':
      from = local.startOf('month').minus({ months: 1 });
      to = local.startOf('month');
      label = `за ${from.setLocale('ru').toFormat('LLLL yyyy')}`;
      break;
  }
  return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate(), preset, timezone, label };
}

/** Custom range from "YYYY-MM-DD" dates (inclusive) interpreted in the company timezone. */
export function resolveCustomRange(fromDate: string, toDate: string, timezone: string): ResolvedRange {
  assertTimezone(timezone);
  const from = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');
  const toDay = DateTime.fromISO(toDate, { zone: timezone }).startOf('day');
  if (!from.isValid || !toDay.isValid) throw new RangeError('Invalid date');
  if (toDay < from) throw new RangeError('"to" must not be before "from"');
  if (toDay.diff(from, 'days').days > 366) throw new RangeError('Range must not exceed 366 days');
  return {
    from: from.toUTC().toJSDate(),
    to: toDay.plus({ days: 1 }).toUTC().toJSDate(),
    preset: 'custom',
    timezone,
    label: `${fmt(from)} – ${fmt(toDay)}`,
  };
}

/** Local calendar date key ("YYYY-MM-DD") of an instant in a timezone. */
export function localDateKey(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date).setZone(timezone).toISODate() ?? '';
}
