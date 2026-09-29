/**
 * Low-level HTTP client for the Clopos Open API.
 *  - sends the token in the `x-token` header (per docs)
 *  - re-authenticates once on 401
 *  - retries 429 / 5xx / network errors with exponential backoff (GET only;
 *    non-idempotent requests are retried on 429 only)
 *  - per-request timeout
 *  - never logs or embeds tokens in errors
 */
import { type CloposAuth, type FetchLike, joinUrl } from './auth';
import { CloposAuthError, CloposError, CloposHttpError } from './errors';

export interface ClientLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug?(obj: Record<string, unknown>, msg: string): void;
}

export interface CloposClientOptions {
  apiUrl: string;
  auth: CloposAuth;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: ClientLogger;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new CloposError(`Missing path parameter "${key}"`, 'CLOPOS_BAD_REQUEST');
    return encodeURIComponent(value);
  });
}

export class CloposClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: CloposClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get auth(): CloposAuth {
    return this.opts.auth;
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const resolved = buildPath(path, options.pathParams);
    const url = new URL(joinUrl(this.opts.apiUrl, resolved));
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const maxRetries = this.opts.maxRetries ?? 2;
    const idempotent = method === 'GET';
    let reauthed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.opts.auth.getToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            accept: 'application/json',
            'x-token': token,
            ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
        if (idempotent && attempt < maxRetries) {
          this.opts.logger?.warn({ path: resolved, attempt, reason }, 'clopos request failed, retrying');
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new CloposError(`Clopos ${method} ${resolved} failed (${reason})`, 'CLOPOS_UNAVAILABLE', 503);
      }
      clearTimeout(timer);

      if (res.status === 401 && !reauthed) {
        reauthed = true;
        await this.opts.auth.invalidate();
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new CloposAuthError(`Clopos denied ${method} ${resolved}`, res.status);
      }
      const retryable = res.status === 429 || (idempotent && res.status >= 500);
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : backoff(attempt);
        this.opts.logger?.warn({ path: resolved, status: res.status, attempt }, 'clopos request retry');
        await this.sleep(wait);
        continue;
      }

      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!res.ok) {
        const detail = json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message).slice(0, 200) : undefined;
        throw new CloposHttpError(res.status, method, resolved, detail);
      }
      return json as T;
    }
  }

  get<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>('POST', path, options);
  }
}

function backoff(attempt: number): number {
  return Math.min(300 * 2 ** attempt, 4000);
}
