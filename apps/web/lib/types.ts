import type { Role } from '@cpos/shared';

export interface User {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  telegramId: string | null;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  timezone: string;
  currency: string;
}

export interface Capabilities {
  products: boolean;
  categories: boolean;
  venues: boolean;
  storages: boolean;
  suppliers: boolean;
  stock: boolean;
  createIncoming: boolean;
  incomingOperations: boolean;
  salesReport: boolean;
}

export interface SalesSummary {
  sales: number;
  orders: number;
  averageCheck: number;
  payments: { cash: number; card: number; other: number };
  paymentMethods: { name: string; bucket: 'cash' | 'card' | 'other'; amount: number }[];
  cost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  salesByDay: { date: string; sales: number; orders: number; cost: number | null; profit: number | null }[];
  topProducts: { name: string; quantity: number; total: number }[] | null;
}

export interface RangeInfo {
  preset: string;
  label: string;
  from: string;
  to: string;
  timezone: string;
}

export interface InventorySummary {
  positions: number;
  totalQuantity: number;
  totalValue: number | null;
  lowStock: { productName: string; quantity: number }[];
}

export type InventoryState = { available: true; summary: InventorySummary } | { available: false; reason: string };

export interface FullReport {
  range: RangeInfo;
  source: 'real' | 'mock';
  sales: SalesSummary;
  expenses: { incoming: number; salary: number; total: number };
  inventory: InventoryState;
  warnings: string[];
  generatedAt: string;
}

export interface Dashboard {
  range: RangeInfo;
  source: 'real' | 'mock';
  capabilities: Capabilities;
  cards: {
    sales: number;
    orders: number;
    averageCheck: number;
    profit: number | null;
    stock: { positions: number; value: number | null } | null;
    incoming: number;
    salaryPaid: number;
    payrollCurrentMonth: number;
  };
  charts: {
    salesByDay: SalesSummary['salesByDay'];
    paymentMethods: SalesSummary['paymentMethods'];
    paymentBuckets: SalesSummary['payments'];
    topProducts: SalesSummary['topProducts'];
    expensesByDay: { date: string; incoming: number; salary: number; total: number }[];
    profitByDay: { date: string; sales: number; cost: number | null; profit: number | null }[];
  };
  inventory: InventoryState;
  warnings: string[];
}

export interface Option {
  id: string;
  name: string;
}

export interface Product extends Option {
  categoryId: string | null;
  price: number | null;
  type: string | null;
}

export interface Stock {
  productId: string;
  productName: string;
  storageId: string | null;
  quantity: number;
  unit: string | null;
  cost: number | null;
}

export interface Incoming {
  id: string;
  storageName: string;
  supplierName: string;
  status: 'PENDING' | 'SYNCED' | 'LOCAL_ONLY' | 'FAILED';
  cloposOperationId: string | null;
  syncError: string | null;
  total: number;
  note: string | null;
  source: string;
  createdAt: string;
  items: { id: string; productId: string; productName: string; quantity: number; price: number; total: number }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  baseSalary: number;
  active: boolean;
  telegramId: string | null;
  createdAt: string;
}

export interface SalaryRecord {
  id: string;
  employeeId: string;
  employeeName: string | null;
  position: string | null;
  period: string;
  baseSalary: number;
  bonus: number;
  penalty: number;
  advance: number;
  total: number;
  status: 'DRAFT' | 'PAID';
  paidAt: string | null;
  note: string | null;
}

export interface Payroll {
  period: string;
  items: SalaryRecord[];
  missing: Employee[];
  totals: { baseSalary: number; bonus: number; penalty: number; advance: number; total: number; paid: number; unpaid: number };
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

export interface Schedule {
  id: string;
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  enabled: boolean;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  reportPeriod: 'CURRENT' | 'PREVIOUS';
  extraChatId: string | null;
}

export interface CloposStatus {
  mode: 'real' | 'mock';
  connected: boolean;
  status: string;
  brand: string | null;
  venueId: string | null;
  integratorId: string | null;
  clientIdHint: string | null;
  usesEnvSecret: boolean | null;
  tokenExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  capabilities: Capabilities;
}
