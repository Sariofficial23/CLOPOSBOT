/**
 * Resolves the CloposService for a company.
 *  - CLOPOS_ADAPTER=mock → MockCloposService (development only; refused in production by config)
 *  - CLOPOS_ADAPTER=real → RealCloposService built from the company's encrypted CloposConnection
 *
 * Also owns connecting/disconnecting and connection tests. Secrets are
 * decrypted only in memory and never returned by any API.
 */
import {
  CloposAuth,
  CloposClient,
  type CloposCredentials,
  type CloposService,
  type CloposToken,
  MOCK_CAPABILITIES,
  MockCloposService,
  REAL_CAPABILITIES,
  RealCloposService,
  requestToken,
  type TokenStore,
  validateTokenScope,
} from '@cpos/clopos';
import type { CloposConnectInput } from '@cpos/shared';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env';
import type { Encryptor } from '../lib/crypto';
import { AppError } from '../lib/errors';

class PrismaTokenStore implements TokenStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptor: Encryptor,
    private readonly companyId: string,
  ) {}

  async load(): Promise<CloposToken | null> {
    const c = await this.prisma.cloposConnection.findUnique({
      where: { companyId: this.companyId },
      select: { accessTokenEnc: true, tokenExpiresAt: true },
    });
    if (!c?.accessTokenEnc || !c.tokenExpiresAt) return null;
    try {
      return { token: this.encryptor.decrypt(c.accessTokenEnc), tokenType: 'Bearer', expiresAt: c.tokenExpiresAt };
    } catch {
      return null; // key rotated / corrupted → re-authenticate
    }
  }

  async save(token: CloposToken): Promise<void> {
    await this.prisma.cloposConnection.update({
      where: { companyId: this.companyId },
      data: { accessTokenEnc: this.encryptor.encrypt(token.token), tokenExpiresAt: token.expiresAt },
    });
  }

  async clear(): Promise<void> {
    await this.prisma.cloposConnection.updateMany({
      where: { companyId: this.companyId },
      data: { accessTokenEnc: null, tokenExpiresAt: null },
    });
  }
}

interface Logger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export class CloposRegistry {
  private readonly cache = new Map<string, CloposService>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly encryptor: Encryptor,
    private readonly logger?: Logger,
    /** test hook */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  get mode(): 'real' | 'mock' {
    return this.config.CLOPOS_ADAPTER;
  }

  async forCompany(companyId: string): Promise<CloposService> {
    const cached = this.cache.get(companyId);
    if (cached) return cached;
    let service: CloposService;
    if (this.config.CLOPOS_ADAPTER === 'mock') {
      service = new MockCloposService();
    } else {
      const conn = await this.prisma.cloposConnection.findUnique({ where: { companyId } });
      if (!conn || conn.status === 'DISCONNECTED') {
        throw new AppError(409, 'CLOPOS_NOT_CONNECTED', 'Clopos не подключён. Подключите его в Настройках.');
      }
      const creds = this.credentialsFrom(conn);
      const auth = new CloposAuth(creds, new PrismaTokenStore(this.prisma, this.encryptor, companyId), {
        apiUrl: this.config.CLOPOS_API_URL,
        fetch: this.fetchImpl,
      });
      const client = new CloposClient({ apiUrl: this.config.CLOPOS_API_URL, auth, fetch: this.fetchImpl, logger: this.logger });
      service = new RealCloposService(client, { venueId: conn.venueId ?? undefined, stockPath: this.config.CLOPOS_STOCK_PATH });
    }
    this.cache.set(companyId, service);
    return service;
  }

  invalidate(companyId: string) {
    this.cache.delete(companyId);
  }

  private credentialsFrom(conn: { brand: string; clientId: string; clientSecretEnc: string | null; integratorId: string }): CloposCredentials {
    const clientSecret = conn.clientSecretEnc ? this.encryptor.decrypt(conn.clientSecretEnc) : this.config.CLOPOS_CLIENT_SECRET;
    if (!clientSecret) throw new AppError(500, 'CLOPOS_MISCONFIGURED', 'Clopos client secret is not configured');
    return { brand: conn.brand, clientId: conn.clientId, clientSecret, integratorId: conn.integratorId };
  }

  /**
   * Validate credentials against POST /v2/auth, then store them encrypted.
   * Credentials missing from the body fall back to the server environment.
   */
  async connect(companyId: string, input: CloposConnectInput) {
    if (this.config.CLOPOS_ADAPTER === 'mock') {
      throw new AppError(409, 'CLOPOS_MOCK_MODE', 'Server runs with CLOPOS_ADAPTER=mock; set it to "real" to connect Clopos');
    }
    const clientId = input.clientId ?? this.config.CLOPOS_CLIENT_ID;
    const clientSecret = input.clientSecret ?? this.config.CLOPOS_CLIENT_SECRET;
    const integratorId = input.integratorId ?? this.config.CLOPOS_INTEGRATOR_ID;
    if (!clientId || !clientSecret || !integratorId) {
      throw new AppError(400, 'CLOPOS_CREDENTIALS_MISSING', 'client_id, client_secret and integrator_id are required (body or server env)');
    }
    const creds = { brand: input.brand, clientId, clientSecret, integratorId };
    const token = await requestToken(creds, { apiUrl: this.config.CLOPOS_API_URL, fetch: this.fetchImpl });
    const scope = validateTokenScope(token.token, { brand: input.brand, integratorId, venueId: input.venueId });
    if (!scope.ok) throw new AppError(400, 'CLOPOS_SCOPE_MISMATCH', scope.problems.join('; '));

    const data = {
      brand: input.brand,
      clientId,
      // store the secret only when it came from the request (env secrets stay in env)
      clientSecretEnc: input.clientSecret ? this.encryptor.encrypt(input.clientSecret) : null,
      integratorId,
      venueId: input.venueId || (scope.claims.venueId ?? null),
      accessTokenEnc: this.encryptor.encrypt(token.token),
      tokenExpiresAt: token.expiresAt,
      status: 'CONNECTED' as const,
      lastError: null,
      lastCheckedAt: new Date(),
      connectedAt: new Date(),
    };
    await this.prisma.cloposConnection.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
    this.invalidate(companyId);
    return this.status(companyId);
  }

  async disconnect(companyId: string) {
    await this.prisma.cloposConnection.updateMany({
      where: { companyId },
      data: { status: 'DISCONNECTED', accessTokenEnc: null, tokenExpiresAt: null, clientSecretEnc: null },
    });
    this.invalidate(companyId);
  }

  /** Public, non-secret connection info. */
  async status(companyId: string) {
    const c = await this.prisma.cloposConnection.findUnique({ where: { companyId } });
    return {
      mode: this.config.CLOPOS_ADAPTER,
      connected: this.config.CLOPOS_ADAPTER === 'mock' ? true : c?.status === 'CONNECTED',
      status: c?.status ?? 'DISCONNECTED',
      brand: c?.brand ?? null,
      venueId: c?.venueId ?? null,
      integratorId: c?.integratorId ?? null,
      clientIdHint: c?.clientId ? `${c.clientId.slice(0, 4)}…` : null,
      usesEnvSecret: c ? c.clientSecretEnc === null : null,
      tokenExpiresAt: c?.tokenExpiresAt ?? null,
      lastCheckedAt: c?.lastCheckedAt ?? null,
      lastError: c?.lastError ?? null,
      capabilities: this.config.CLOPOS_ADAPTER === 'mock' ? MOCK_CAPABILITIES : { ...REAL_CAPABILITIES, stock: !!this.config.CLOPOS_STOCK_PATH },
    };
  }

  async test(companyId: string) {
    const service = await this.forCompany(companyId);
    const result = await service.testConnection();
    if (service.mode === 'real') {
      await this.prisma.cloposConnection.update({
        where: { companyId },
        data: {
          lastCheckedAt: new Date(),
          status: result.ok ? 'CONNECTED' : 'ERROR',
          lastError: result.ok ? null : result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? 'failed'}`).join('; ').slice(0, 500),
        },
      });
    }
    return result;
  }
}
