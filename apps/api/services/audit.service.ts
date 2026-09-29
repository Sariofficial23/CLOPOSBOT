import type { Prisma, PrismaClient } from '@prisma/client';
import { sanitize } from '../lib/logger';

export const AuditAction = {
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTH_TELEGRAM_LOGIN: 'AUTH_TELEGRAM_LOGIN',
  AUTH_BOT_DENIED: 'AUTH_BOT_DENIED',
  INCOMING_CREATE: 'INCOMING_CREATE',
  EMPLOYEE_CREATE: 'EMPLOYEE_CREATE',
  EMPLOYEE_UPDATE: 'EMPLOYEE_UPDATE',
  SALARY_CALCULATE: 'SALARY_CALCULATE',
  SALARY_UPDATE: 'SALARY_UPDATE',
  SALARY_ADJUST: 'SALARY_ADJUST',
  SALARY_PAY: 'SALARY_PAY',
  REPORT_GENERATE: 'REPORT_GENERATE',
  REPORT_SCHEDULED_SENT: 'REPORT_SCHEDULED_SENT',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  SCHEDULE_UPDATE: 'SCHEDULE_UPDATE',
  CLOPOS_CONNECT: 'CLOPOS_CONNECT',
  CLOPOS_DISCONNECT: 'CLOPOS_DISCONNECT',
  CLOPOS_TEST: 'CLOPOS_TEST',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  COMPANY_DELETE: 'COMPANY_DELETE',
  CATALOG_CREATE: 'CATALOG_CREATE',
  CATALOG_UPDATE: 'CATALOG_UPDATE',
  STOCK_IMPORT: 'STOCK_IMPORT',
} as const;
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: AuditActionName;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

interface MinimalLogger {
  error(obj: unknown, msg?: string): void;
}

export class AuditService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: MinimalLogger = console,
  ) {}

  /** Never throws: an audit failure must not break the business action (it is logged instead). */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ? (sanitize(entry.metadata) as Prisma.InputJsonValue) : undefined,
          ip: entry.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.message : 'unknown', action: entry.action }, 'audit log write failed');
    }
  }

  async list(companyId: string, opts: { page: number; pageSize: number; action?: string; entity?: string; userId?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      companyId,
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.entity ? { entity: opts.entity } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(items.map((i) => i.userId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: items.map((i) => ({ ...i, userName: i.userId ? (names.get(i.userId) ?? null) : null })),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }
}
