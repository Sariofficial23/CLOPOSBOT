import { describe, expect, it } from 'vitest';
import { resolveCustomRange, resolvePreset } from '../src/periods';
import { formatAmount, formatMoney, round2 } from '../src/money';
import { isDue, latestOccurrence, occurrenceKey, rangeForOccurrence } from '../src/schedule';

const TZ = 'Asia/Tashkent'; // UTC+5, no DST

describe('resolvePreset', () => {
  const now = new Date('2026-09-29T20:30:00Z'); // 2026-09-30 01:30 in Tashkent (Wednesday)

  it('today uses the company timezone', () => {
    const r = resolvePreset('today', TZ, now);
    expect(r.from.toISOString()).toBe('2026-09-29T19:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-30T19:00:00.000Z');
  });

  it('yesterday', () => {
    const r = resolvePreset('yesterday', TZ, now);
    expect(r.from.toISOString()).toBe('2026-09-28T19:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-29T19:00:00.000Z');
  });

  it('week starts on Monday', () => {
    const r = resolvePreset('week', TZ, now);
    expect(r.from.toISOString()).toBe('2026-09-27T19:00:00.000Z'); // Mon 2026-09-28 00:00 local
  });

  it('last_month covers the whole previous month', () => {
    const r = resolvePreset('last_month', TZ, now);
    expect(r.from.toISOString()).toBe('2026-07-31T19:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('custom range is inclusive of the end date', () => {
    const r = resolveCustomRange('2026-09-01', '2026-09-02', TZ);
    expect(r.to.getTime() - r.from.getTime()).toBe(2 * 24 * 3600 * 1000);
  });

  it('rejects inverted ranges and unknown timezones', () => {
    expect(() => resolveCustomRange('2026-09-02', '2026-09-01', TZ)).toThrow();
    expect(() => resolvePreset('today', 'Mars/Olympus')).toThrow();
  });
});

describe('schedules', () => {
  it('daily 23:00 local = 18:00 UTC', () => {
    const occ = latestOccurrence({ type: 'DAILY', hour: 23, minute: 0, reportPeriod: 'CURRENT' }, TZ, new Date('2026-09-29T18:05:00Z'));
    expect(occ.toUTC().toISO()).toBe('2026-09-29T18:00:00.000Z');
  });

  it('daily before the time returns yesterday', () => {
    const occ = latestOccurrence({ type: 'DAILY', hour: 23, minute: 0, reportPeriod: 'CURRENT' }, TZ, new Date('2026-09-29T17:59:00Z'));
    expect(occ.toUTC().toISO()).toBe('2026-09-28T18:00:00.000Z');
  });

  it('weekly Monday 09:00', () => {
    const spec = { type: 'WEEKLY' as const, hour: 9, minute: 0, dayOfWeek: 1, reportPeriod: 'PREVIOUS' as const };
    const occ = latestOccurrence(spec, TZ, new Date('2026-09-29T10:00:00Z')); // Tuesday
    expect(occ.toISODate()).toBe('2026-09-28');
    const range = rangeForOccurrence(spec, occ, TZ);
    expect(range.from.toISOString()).toBe('2026-09-20T19:00:00.000Z'); // Mon 2026-09-21 local
    expect(range.to.toISOString()).toBe('2026-09-27T19:00:00.000Z');
  });

  it('monthly 1st 09:00 reports the previous month', () => {
    const spec = { type: 'MONTHLY' as const, hour: 9, minute: 0, dayOfMonth: 1, reportPeriod: 'PREVIOUS' as const };
    const occ = latestOccurrence(spec, TZ, new Date('2026-10-01T04:30:00Z')); // 09:30 local
    expect(occ.toISODate()).toBe('2026-10-01');
    expect(occurrenceKey(spec, occ)).toBe('MONTHLY:2026-10-01T09:00');
    const range = rangeForOccurrence(spec, occ, TZ);
    expect(range.from.toISOString()).toBe('2026-08-31T19:00:00.000Z');
  });

  it('isDue respects lag window and creation time', () => {
    const occ = latestOccurrence({ type: 'DAILY', hour: 23, minute: 0, reportPeriod: 'CURRENT' }, TZ, new Date('2026-09-29T18:10:00Z'));
    expect(isDue(occ, new Date('2026-09-29T18:10:00Z'), 180)).toBe(true);
    expect(isDue(occ, new Date('2026-09-29T23:00:00Z'), 180)).toBe(false);
    expect(isDue(occ, new Date('2026-09-29T18:10:00Z'), 180, new Date('2026-09-29T18:05:00Z'))).toBe(false);
  });
});

describe('money formatting', () => {
  it('groups thousands with spaces', () => {
    expect(formatAmount(12_450_000)).toBe('12 450 000');
    expect(formatMoney(8000)).toBe('8 000 сум');
    expect(formatAmount(-1234.5)).toBe('-1 234,50');
    expect(round2(1.005)).toBe(1.01);
  });
});
