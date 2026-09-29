/**
 * Local directories (warehouses, suppliers). Used for incoming goods when the
 * Clopos Open API does not provide the corresponding endpoints.
 */
import { supplierSchema, supplierUpdateSchema, warehouseSchema, warehouseUpdateSchema } from '@cpos/shared';
import type { PrismaClient, Supplier, Warehouse } from '@prisma/client';
import { Errors } from '../lib/errors';
import { isUniqueViolation } from '../lib/prisma';
import { AuditAction, type AuditService } from './audit.service';
import type { Actor } from './types';

const serializeWarehouse = (w: Warehouse) => ({ id: w.id, name: w.name, active: w.active, createdAt: w.createdAt.toISOString() });
const serializeSupplier = (s: Supplier) => ({ id: s.id, name: s.name, phone: s.phone, active: s.active, createdAt: s.createdAt.toISOString() });

export class CatalogService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async listWarehouses(companyId: string, activeOnly = false) {
    const rows = await this.prisma.warehouse.findMany({
      where: { companyId, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(serializeWarehouse);
  }

  async listSuppliers(companyId: string, activeOnly = false) {
    const rows = await this.prisma.supplier.findMany({
      where: { companyId, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(serializeSupplier);
  }

  private duplicate(err: unknown): never {
    if (isUniqueViolation(err)) throw Errors.conflict('DUPLICATE_NAME', 'Запись с таким названием уже существует');
    throw err;
  }

  async createWarehouse(actor: Actor, raw: unknown) {
    const input = warehouseSchema.parse(raw);
    const w = await this.prisma.warehouse.create({ data: { companyId: actor.companyId, ...input } }).catch((e) => this.duplicate(e));
    await this.audit.log({ companyId: actor.companyId, userId: actor.id, action: AuditAction.CATALOG_CREATE, entity: 'Warehouse', entityId: w.id, metadata: { name: w.name }, ip: actor.ip });
    return serializeWarehouse(w);
  }

  async updateWarehouse(actor: Actor, id: string, raw: unknown) {
    const input = warehouseUpdateSchema.parse(raw);
    const before = await this.prisma.warehouse.findFirst({ where: { id, companyId: actor.companyId } });
    if (!before) throw Errors.notFound('Warehouse');
    const w = await this.prisma.warehouse.update({ where: { id }, data: input }).catch((e) => this.duplicate(e));
    await this.audit.log({ companyId: actor.companyId, userId: actor.id, action: AuditAction.CATALOG_UPDATE, entity: 'Warehouse', entityId: id, metadata: { before: { name: before.name, active: before.active }, after: input }, ip: actor.ip });
    return serializeWarehouse(w);
  }

  async createSupplier(actor: Actor, raw: unknown) {
    const input = supplierSchema.parse(raw);
    const s = await this.prisma.supplier.create({ data: { companyId: actor.companyId, ...input, phone: input.phone || null } }).catch((e) => this.duplicate(e));
    await this.audit.log({ companyId: actor.companyId, userId: actor.id, action: AuditAction.CATALOG_CREATE, entity: 'Supplier', entityId: s.id, metadata: { name: s.name }, ip: actor.ip });
    return serializeSupplier(s);
  }

  async updateSupplier(actor: Actor, id: string, raw: unknown) {
    const input = supplierUpdateSchema.parse(raw);
    const before = await this.prisma.supplier.findFirst({ where: { id, companyId: actor.companyId } });
    if (!before) throw Errors.notFound('Supplier');
    const s = await this.prisma.supplier.update({ where: { id }, data: { ...input, ...(input.phone !== undefined ? { phone: input.phone || null } : {}) } }).catch((e) => this.duplicate(e));
    await this.audit.log({ companyId: actor.companyId, userId: actor.id, action: AuditAction.CATALOG_UPDATE, entity: 'Supplier', entityId: id, metadata: { before: { name: before.name, active: before.active }, after: input }, ip: actor.ip });
    return serializeSupplier(s);
  }
}
