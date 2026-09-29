/** Round to 2 decimal places, avoiding binary float artefacts (1.005 -> 1.01). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sum a list of amounts with 2-decimal rounding. */
export function sumMoney(values: readonly number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

/**
 * Format an amount with space thousand separators, e.g. 12450000 -> "12 450 000".
 * Decimals are shown only when non-zero. Uses a plain space so the output is
 * safe for Telegram messages.
 */
export function formatAmount(value: number): string {
  const rounded = round2(value);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const intPart = Math.trunc(abs);
  const frac = Math.round((abs - intPart) * 100);
  const grouped = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const withFrac = frac > 0 ? `${grouped},${String(frac).padStart(2, '0')}` : grouped;
  return negative ? `-${withFrac}` : withFrac;
}

export function formatMoney(value: number, currency = 'сум'): string {
  return currency ? `${formatAmount(value)} ${currency}` : formatAmount(value);
}
