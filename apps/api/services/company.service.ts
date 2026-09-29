import { assertTimezone, companySettingsSchema } from '@cpos/shared';
import type { PrismaClient } from '@prisma/client';
import { Errors } from '../lib/errors';
import { AuditAction, type AuditService } from './audit.service';
import type { Actor } from './types';

export class CompanyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!c) throw Errors.notFound('Company');
    return { id: c.id, name: c.name, timezone: c.timezone, currency: c.currency, createdAt: c.createdAt.toISOString() };
  }

  async update(actor: Actor, raw: unknown) {
    const input = companySettingsSchema.parse(raw);
    if (input.timezone) {
      try {
        assertTimezone(input.timezone);
      } catch {
        throw Errors.badRequest(`Неизвестный часовой пояс: ${input.timezone}`);
      }
    }
    const before = await this.get(actor.companyId);
    await this.prisma.company.update({ where: { id: actor.companyId }, data: input });
    await this.audit.log({
      companyId: actor.companyId,
      userId: actor.id,
      action: AuditAction.SETTINGS_UPDATE,
      entity: 'Company',
      entityId: actor.companyId,
      metadata: { before: { name: before.name, timezone: before.timezone, currency: before.currency }, after: input },
      ip: actor.ip,
    });
    return this.get(actor.companyId);
  }

  /** SUPER_ADMIN only (enforced by route permission `company:delete`). */
  async remove(actor: Actor, companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!c) throw Errors.notFound('Company');
    // audit row goes to the actor's company (the deleted company's logs cascade away)
    await this.audit.log({
      companyId: actor.companyId === companyId ? null : actor.companyId,
      userId: actor.id,
      action: AuditAction.COMPANY_DELETE,
      entity: 'Company',
      entityId: companyId,
      metadata: { name: c.name },
      ip: actor.ip,
    });
    await this.prisma.company.delete({ where: { id: companyId } });
  }
}
