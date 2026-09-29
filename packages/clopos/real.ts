import { validateTokenScope } from './auth';
import type { CloposClient } from './client';
import { unverifiedEndpoints } from './endpoints';
import { CloposError } from './errors';
import * as inventory from './inventory';
import { listReceipts } from './sales';
import type { ConnectionTestResult, CloposService } from './service';
import type { CloposCapabilities, DateRange, IncomingInput, SalesReportData } from './types';

/**
 * Production adapter — talks to the official Clopos Open API only.
 * Capabilities reflect what the documentation actually offers.
 */
export const REAL_CAPABILITIES: Readonly<CloposCapabilities> = Object.freeze({
  products: true,
  categories: true,
  venues: true,
  storages: false, // TODO(clopos-endpoint)
  suppliers: false, // TODO(clopos-endpoint)
  stock: false, // TODO(clopos-endpoint)
  createIncoming: false, // TODO(clopos-endpoint)
  incomingOperations: false, // TODO(clopos-endpoint)
  salesReport: true,
});

export class RealCloposService implements CloposService {
  readonly mode = 'real' as const;
  readonly capabilities: CloposCapabilities = { ...REAL_CAPABILITIES };

  constructor(
    private readonly client: CloposClient,
    private readonly scope: { venueId?: string } = {},
  ) {}

  getProducts() {
    return inventory.getProducts(this.client);
  }
  getCategories() {
    return inventory.getCategories(this.client);
  }
  getVenues() {
    return inventory.getVenues(this.client);
  }
  getStorages() {
    return inventory.getStorages(this.client);
  }
  getSuppliers() {
    return inventory.getSuppliers(this.client);
  }
  getStock() {
    return inventory.getStock(this.client);
  }
  createIncoming(data: IncomingInput) {
    return inventory.createIncoming(this.client, data);
  }
  getIncomingOperations(range?: DateRange) {
    return inventory.getIncomingOperations(this.client, range);
  }

  async getSalesReport(range: DateRange): Promise<SalesReportData> {
    const receipts = await listReceipts(this.client, range);
    return {
      receipts,
      costAvailable: receipts.length > 0 && receipts.every((r) => r.cost !== null),
      linesAvailable: receipts.some((r) => r.lines !== null),
      source: 'real',
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const checks: ConnectionTestResult['checks'] = [];
    const auth = this.client.auth;
    try {
      const token = await auth.authenticate();
      checks.push({ name: 'auth', ok: true });
      const scope = validateTokenScope(token.token, {
        brand: auth.brand,
        integratorId: auth.integratorId,
        venueId: this.scope.venueId,
      });
      checks.push({ name: 'scope', ok: scope.ok, detail: scope.ok ? undefined : scope.problems.join('; ') });
    } catch (err) {
      checks.push({ name: 'auth', ok: false, detail: safeMessage(err) });
      return { ok: false, mode: this.mode, checks, capabilities: this.capabilities };
    }
    try {
      const products = await this.getProducts();
      checks.push({ name: 'products', ok: true, detail: `${products.length} products` });
    } catch (err) {
      checks.push({ name: 'products', ok: false, detail: safeMessage(err) });
    }
    const unverified = unverifiedEndpoints();
    if (unverified.length) {
      checks.push({
        name: 'unverified-endpoints',
        ok: true,
        detail: `Verify against docs: ${unverified.map((e) => `${e.method} ${e.path}`).join(', ')}`,
      });
    }
    return { ok: checks.every((c) => c.ok), mode: this.mode, checks, capabilities: this.capabilities };
  }
}

function safeMessage(err: unknown): string {
  if (err instanceof CloposError) return err.message;
  return 'Unexpected error';
}
