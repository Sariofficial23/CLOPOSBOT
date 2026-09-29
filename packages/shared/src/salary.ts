import { round2 } from './money';

export interface SalaryComponents {
  baseSalary: number;
  bonus: number;
  penalty: number;
  advance: number;
}

/**
 * total = baseSalary + bonus - penalty - advance
 *
 * All components must be finite and non-negative. The total can be negative
 * when advances exceed earnings; callers decide how to present that.
 */
export function calculateSalaryTotal(c: SalaryComponents): number {
  for (const [key, value] of Object.entries(c)) {
    if (!Number.isFinite(value)) throw new RangeError(`${key} must be a finite number`);
    if (value < 0) throw new RangeError(`${key} must not be negative`);
  }
  return round2(c.baseSalary + c.bonus - c.penalty - c.advance);
}

/** Salary periods are calendar months in "YYYY-MM" form. */
export const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_REGEX.test(period);
}

export function periodFromDate(date: Date, timezone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}
