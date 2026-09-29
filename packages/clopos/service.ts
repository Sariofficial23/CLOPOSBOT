import type {
  Category,
  CloposCapabilities,
  DateRange,
  IncomingInput,
  IncomingOperation,
  IncomingResult,
  Product,
  SalesReportData,
  Stock,
  Storage,
  Supplier,
  Venue,
} from './types';

export interface ConnectionTestResult {
  ok: boolean;
  mode: 'real' | 'mock';
  checks: { name: string; ok: boolean; detail?: string }[];
  capabilities: CloposCapabilities;
}

/**
 * The only way application code talks to Clopos.
 * Production: RealCloposService. Development/tests: MockCloposService.
 */
export interface CloposService {
  readonly mode: 'real' | 'mock';
  readonly capabilities: CloposCapabilities;
  getProducts(): Promise<Product[]>;
  getCategories(): Promise<Category[]>;
  getVenues(): Promise<Venue[]>;
  getStorages(): Promise<Storage[]>;
  getSuppliers(): Promise<Supplier[]>;
  getStock(): Promise<Stock[]>;
  createIncoming(data: IncomingInput): Promise<IncomingResult>;
  getIncomingOperations(range?: DateRange): Promise<IncomingOperation[]>;
  getSalesReport(range: DateRange): Promise<SalesReportData>;
  testConnection(): Promise<ConnectionTestResult>;
}
