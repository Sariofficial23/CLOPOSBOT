import { describe, expect, it } from 'vitest';
import { calculateSalaryTotal, isValidPeriod, periodFromDate } from '../src/salary';

describe('calculateSalaryTotal', () => {
  it('applies total = base + bonus - penalty - advance', () => {
    expect(calculateSalaryTotal({ baseSalary: 5_000_000, bonus: 500_000, penalty: 200_000, advance: 1_000_000 })).toBe(
      4_300_000,
    );
  });

  it('returns base salary when there are no adjustments', () => {
    expect(calculateSalaryTotal({ baseSalary: 3_000_000, bonus: 0, penalty: 0, advance: 0 })).toBe(3_000_000);
  });

  it('may go negative when advances exceed earnings', () => {
    expect(calculateSalaryTotal({ baseSalary: 1_000, bonus: 0, penalty: 0, advance: 1_500 })).toBe(-500);
  });

  it('rounds to 2 decimals without float artefacts', () => {
    expect(calculateSalaryTotal({ baseSalary: 0.1, bonus: 0.2, penalty: 0, advance: 0 })).toBe(0.3);
  });

  it('rejects negative components', () => {
    expect(() => calculateSalaryTotal({ baseSalary: 100, bonus: -1, penalty: 0, advance: 0 })).toThrow(/bonus/);
  });

  it('rejects non-finite components', () => {
    expect(() => calculateSalaryTotal({ baseSalary: Number.NaN, bonus: 0, penalty: 0, advance: 0 })).toThrow();
  });
});

describe('periods', () => {
  it('validates YYYY-MM', () => {
    expect(isValidPeriod('2026-09')).toBe(true);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('26-09')).toBe(false);
  });

  it('derives the period in the company timezone', () => {
    // 2026-09-30 20:00 UTC is already 2026-10-01 in Tashkent (UTC+5)
    expect(periodFromDate(new Date('2026-09-30T20:00:00Z'), 'Asia/Tashkent')).toBe('2026-10');
    expect(periodFromDate(new Date('2026-09-30T20:00:00Z'), 'UTC')).toBe('2026-09');
  });
});
