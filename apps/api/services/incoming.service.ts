/**
 * Incoming goods (приход товара).
 *
 * Order of operations (safe against partial failure):
 *   1. validate input (Zod) and, where Clopos can list them, check the
 *      storage / supplier / products exist
 *   2. save locally as PENDING (idempotency key prevents duplicates)
 *   3. send to Clopos
 *   4. mark SYNCED (with Clopos id) / LOCAL_ONLY (no Clopos endpoint) / FAILED
 *   5. audit log
 */
import { CloposError, CloposNotSupportedError } from '@cpos/clopos';
import { type IncomingInputDto, incomingInputSchema, round2 } from '@cpos/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../lib/errors';
import { isUniqueViolation, toNumber } from '../lib/prisma';
import { AuditAction, type AuditService } from './audit.service';
import type { CatalogService } from './catalog.service';
import type { CloposRegistry } from './clopos.service';
import type { Actor } from './types';

const includeItems = { items: true } satisfies Prisma.IncomingInclude;
type IncomingWithItems = Prisma.IncomingGetPayload<{ include: typeof includeItems }>;

export function serializeIncoming(i: IncomingWithItems) {
  return {
    id: i.id,
    storageId: i.storageId,
    storageName: i.storageName,
    supplierId: i.supplierId,
    supplierName: i.supplierName,
    status: i.status,
    cloposOperationId: i.cloposOperationId,
    syncError: i.syncError,
    total: toNumber(i.total),
    note: i.note,
    source: i.source,
    userId: i.userId,
    createdAt: i.createdAt.toISOString(),
    items: i.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.productName,
      quantity: toNumber(it.quantity),
      price: toNumber(it.price),
      total: toNumber(it.total),
    })),
  };
}
export type IncomingDto = ReturnType<typeof serializeIncoming>;

export function incomingTotal(items: { quantity: number; price: number }[]): number {
  return round2(items.reduce((a, i) => a + round2(i.quantity * i.price), 0));
}

export class IncomingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clopos: CloposRegistry,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * Storages / suppliers / products for pickers (bot + web form).
   * Storages and suppliers come from Clopos when it offers them, otherwise from
   * the local directories (Справочники). Products always come from Clopos.
   */
  async options(companyId: string) {
    const service = await this.clopos.forCompany(companyId);
    const caps = service.capabilities;
    const pick = (o: { id: string; name: string }) => ({ id: o.id, name: o.name });
    const [storages, suppliers, products] = await Promise.all([
      caps.storages ? service.getStorages() : this.catalog.listWarehouses(companyId, true).then((l) => l.map(pick)),
      caps.suppliers ? service.getSuppliers() : this.catalog.listSuppliers(companyId, true).then((l) => l.map(pick)),
      // a Clopos failure here must not hide the reason from the user
      caps.products ? service.getProducts().catch(() => null) : Promise.resolve([]),
    ]);
    const productsFailed = products === null;
    const sources = { storages: caps.storages ? ('clopos' as const) : ('local' as const), suppliers: caps.suppliers ? ('clopos' as const) : ('local' as const) };
    const missing: string[] = [];
    if (!storages.length) missing.push(sources.storages === 'local' ? 'склады (добавьте в «Справочниках»)' : 'склады в Clopos');
    if (!suppliers.length) missing.push(sources.suppliers === 'local' ? 'поставщики (добавьте в «Справочниках»)' : 'поставщики в Clopos');
    if (productsFailed) missing.push('товары (не удалось загрузить из Clopos — проверьте подключение в Настройках)');
    else if (!products.length) missing.push('товары в Clopos');
    return {
      available: missing.length === 0,
      mode: service.mode,
      sources,
      reason: missing.length ? `Для прихода не хватает: ${missing.join(', ')}.` : null,
      storages,
      suppliers,
      products: products ?? [],
    };
  }

  /** Business validation against the catalogue (Clopos or local directories). */
  async validateAgainstCatalog(companyId: string, input: IncomingInputDto) {
    const opts = await this.options(companyId);
    const problems: string[] = [];
    if (!opts.storages.some((s) => s.id === input.storageId)) problems.push('Склад не найден');
    if (!opts.suppliers.some((s) => s.id === input.supplierId)) problems.push('Поставщик не найден');
    if (opts.products.length) {
      const productIds = new Set(opts.products.map((p) => p.id));
      for (const item of input.items) if (!productIds.has(item.productId)) problems.push(`Товар не найден: ${item.productName}`);
    }
    const seen = new Set<string>();
    for (const item of input.items) {
      if (seen.has(item.productId)) problems.push(`Товар указан дважды: ${item.productName}`);
      seen.add(item.productId);
    }
    if (problems.length) throw new AppError(400, 'INCOMING_INVALID', problems.join('; '), problems);
  }

  async create(actor: Actor, raw: unknown, opts: { source: 'telegram' | 'web'; idempotencyKey?: string }) {
    const input = incomingInputSchema.parse(raw);
    await this.validateAgainstCatalog(actor.companyId, input);
    const total = incomingTotal(input.items);

    let record: IncomingWithItems;
    try {
      record = await this.prisma.incoming.create({
        data: {
          companyId: actor.companyId,
          userId: actor.id,
          idempotencyKey: opts.idempotencyKey ?? null,
          storageId: input.storageId,
          storageName: input.storageName,
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          note: input.note,
          source: opts.source,
          total,
          status: 'PENDING',
          items: {
            create: input.items.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              quantity: i.quantity,
              price: i.price,
              total: round2(i.quantity * i.price),
            })),
          },
        },
        include: includeItems,
      });
    } catch (err) {
      if (opts.idempotencyKey && isUniqueViolation(err)) {
        const existing = await this.prisma.incoming.findUniqueOrThrow({
          where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey: opts.idempotencyKey } },
          include: includeItems,
        });
        return { incoming: serializeIncoming(existing), duplicate: true };
      }
      throw err;
    }

    const service = await this.clopos.forCompany(actor.companyId);
    let status: 'SYNCED' | 'LOCAL_ONLY' | 'FAILED';
    let cloposOperationId: string | null = null;
    let syncError: string | null = null;
    try {
      const res = await service.createIncoming({
        storageId: input.storageId,
        supplierId: input.supplierId,
        note: input.note,
        items: input.items,
        externalRef: record.id,
      });
      status = 'SYNCED';
      cloposOperationId = res.id;
    } catch (err) {
      if (err instanceof CloposNotSupportedError) {
        status = 'LOCAL_ONLY';
        syncError = err.message;
      } else {
        status = 'FAILED';
        syncError = err instanceof CloposError ? err.message : 'Unexpected error while sending to Clopos';
      }
    }
    const updated = await this.prisma.incoming.update({
      where: { id: record.id },
      data: { status, cloposOperationId, syncError },
      include: includeItems,
    });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.INCOMING_CREATE,
      entity: 'Incoming',
      entityId: record.id,
      metadata: {
        status,
        total,
        storage: input.storageName,
        supplier: input.supplierName,
        items: input.items.map((i) => ({ product: i.productName, quantity: i.quantity, price: i.price })),
        source: opts.source,
        cloposOperationId,
      },
      ip: actor.ip,
    });
    return { incoming: serializeIncoming(updated), duplicate: false };
  }

  async list(companyId: string, q: { page: number; pageSize: number; from?: Date; to?: Date }) {
    const where: Prisma.IncomingWhereInput = {
      companyId,
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    };
    const [items, total, sum] = await Promise.all([
      this.prisma.incoming.findMany({
        where,
        include: includeItems,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.incoming.count({ where }),
      this.prisma.incoming.aggregate({ where, _sum: { total: true } }),
    ]);
    return { items: items.map(serializeIncoming), total, page: q.page, pageSize: q.pageSize, sum: toNumber(sum._sum.total) };
  }
}
