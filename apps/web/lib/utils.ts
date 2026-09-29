import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatAmount } from '@cpos/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(value: number | null | undefined, currency = 'сум'): string {
  if (value === null || value === undefined) return '—';
  return `${formatAmount(value)} ${currency}`.trim();
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatAmount(value);
}

/** Compact axis labels: 12 450 000 → 12,5 млн */
export function compact(value: number): string {
  const abs = Math.abs(value);
  const short = (v: number) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace('.', ','));
  if (abs >= 1e9) return `${short(value / 1e9)} млрд`;
  if (abs >= 1e6) return `${short(value / 1e6)} млн`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)} тыс`;
  return String(Math.round(value));
}

export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}.${m}`;
}

export function currentPeriod(timeZone = 'Asia/Tashkent'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}
