import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env';
import { Encryptor } from '../lib/crypto';
import { AuditService } from './audit.service';
import { AuthService } from './auth.service';
import { CatalogService } from './catalog.service';
import { CloposRegistry } from './clopos.service';
import { CompanyService } from './company.service';
import { DashboardService } from './dashboard.service';
import { IncomingService } from './incoming.service';
import { ReportService } from './report.service';
import { SalaryService } from './salary.service';
import { StockImportService } from './stock-import.service';
import { ScheduleService } from './schedule.service';

export interface Services {
  audit: AuditService;
  auth: AuthService;
  catalog: CatalogService;
  stockImport: StockImportService;
  clopos: CloposRegistry;
  company: CompanyService;
  dashboard: DashboardService;
  incoming: IncomingService;
  reports: ReportService;
  salary: SalaryService;
  schedules: ScheduleService;
}

interface Logger {
  error(obj: unknown, msg?: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export function createServices(
  prisma: PrismaClient,
  config: AppConfig,
  logger?: Logger,
  overrides: { fetch?: typeof fetch; clopos?: CloposRegistry } = {},
): Services {
  const audit = new AuditService(prisma, logger);
  const clopos = overrides.clopos ?? new CloposRegistry(prisma, config, new Encryptor(config.ENCRYPTION_KEY), logger, overrides.fetch);
  const stockImport = new StockImportService(prisma, audit);
  const reports = new ReportService(prisma, clopos, audit, stockImport);
  const catalog = new CatalogService(prisma, audit);
  return {
    catalog,
    stockImport,
    audit,
    auth: new AuthService(prisma, audit, config.TELEGRAM_BOT_TOKEN),
    clopos,
    company: new CompanyService(prisma, audit),
    dashboard: new DashboardService(prisma, reports, clopos),
    incoming: new IncomingService(prisma, clopos, audit, catalog),
    reports,
    salary: new SalaryService(prisma, audit),
    schedules: new ScheduleService(prisma, reports, audit, config.REPORT_MAX_LAG_MINUTES),
  };
}
