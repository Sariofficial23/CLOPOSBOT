/**
 * Sales data from Clopos receipts.
 *
 * Documented receipt fields (Get Receipt by ID): id, venue_id, status, total,
 * subtotal, payment_methods[{id, name, amount}], created_at, closed_at,
 * deleted_at, … plus line items.
 */
import type { CloposClient } from './client';
import { ENDPOINTS, RECEIPTS_LIST_QUERY } from './endpoints';
import { extractList, date, isObject, type Json, num, str } from './normalize';
import type { DateRange, NormalizedReceipt, PaymentLine, ReceiptLine } from './types';

/**
 * Map a Clopos receipt to a NormalizedReceipt. Returns null for receipts that
 * are not completed sales (not closed, or deleted).
 */
export function normalizeReceipt(r: Json): NormalizedReceipt | null {
  const id = str(r.id);
  const total = num(r.total);
  const closedAt = date(r.closed_at);
  if (!id || total === null || !closedAt) return null;
  if (r.deleted_at !== null && r.deleted_at !== undefined && r.deleted_at !== '') return null;

  const payments: PaymentLine[] = Array.isArray(r.payment_methods)
    ? r.payment_methods.filter(isObject).map((p) => ({
        id: str(p.id),
        name: str(p.name) ?? 'Другое',
        amount: num(p.amount) ?? 0,
      }))
    : [];

  // TODO(clopos-verify): line-item field name. Docs mention line items on the
  // receipt; we accept `products` or `items` and otherwise report "no lines".
  const rawLines = Array.isArray(r.products) ? r.products : Array.isArray(r.items) ? r.items : null;
  const lines: ReceiptLine[] | null = rawLines
    ? rawLines.filter(isObject).map((l) => ({
        productId: str(l.product_id) ?? str(l.id),
        name: str(l.name) ?? str(l.product_name) ?? '—',
        quantity: num(l.count) ?? num(l.quantity) ?? 0,
        total: num(l.total) ?? num(l.price) ?? 0,
      }))
    : null;

  // Cost is not a documented receipt-list field (see MISSING_ENDPOINTS.receiptCost).
  const cost = num(r.cost);

  return { id, total, closedAt, payments, lines, cost };
}

/**
 * Fetch closed receipts within [from, to).
 * Pagination/date parameters are isolated in RECEIPTS_LIST_QUERY (unverified);
 * results are always re-filtered by closed_at client-side.
 */
export async function listReceipts(client: CloposClient, range: DateRange): Promise<NormalizedReceipt[]> {
  const q = RECEIPTS_LIST_QUERY;
  const seen = new Set<string>();
  const out: NormalizedReceipt[] = [];
  for (let page = 1; page <= q.maxPages; page++) {
    const payload = await client.get(ENDPOINTS.listReceipts.path, {
      query: {
        [q.page]: page,
        [q.limit]: q.pageSize,
        [q.dateFrom]: range.from.toISOString(),
        [q.dateTo]: range.to.toISOString(),
      },
    });
    const rows = extractList(payload, 'receipts');
    let fresh = 0;
    for (const row of rows) {
      const id = str(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh++;
      const receipt = normalizeReceipt(row);
      if (receipt && receipt.closedAt >= range.from && receipt.closedAt < range.to) out.push(receipt);
    }
    // stop on a short page, or when the server ignores paging and repeats itself
    if (rows.length < q.pageSize || fresh === 0) break;
  }
  return out;
}
