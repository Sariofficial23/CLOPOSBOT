/**
 * The ONLY way the browser talks to the outside world: our backend API.
 * Clopos is never called from the browser, and no secret is ever needed here.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const TOKEN_KEY = 'cpos.token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session lasts for the tab only */
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_URL}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Сервер недоступен. Проверьте подключение.');
  }
  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string; details?: unknown } }
    | null;
  if (!res.ok || !body || body.success === false) {
    const error = body && body.success === false ? body.error : { code: 'HTTP_ERROR', message: `Ошибка ${res.status}` };
    if (res.status === 401 && path !== '/api/auth/login') {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, error.code, error.message, 'details' in error ? error.details : undefined);
  }
  return body.data;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      return (err.details as { path: string; message: string }[]).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
    }
    return err.message;
  }
  return 'Неизвестная ошибка';
}
