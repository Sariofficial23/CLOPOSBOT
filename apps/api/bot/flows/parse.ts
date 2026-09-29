/**
 * Parse a user-typed number: "50", "12,5", "1 000", "8 000 сум" → number.
 * Returns null for anything that isn't a plain non-negative decimal.
 */
export function parseNumberInput(text: string): number | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/(сум|sum|so'm|uzs|шт|кг|kg|л)\.?$/u, '')
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
