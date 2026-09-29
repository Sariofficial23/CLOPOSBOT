/**
 * Defensive helpers for mapping Clopos JSON into domain types.
 *
 * TODO(clopos-verify): list-endpoint envelopes were not fully visible in the
 * docs we could access. We accept a bare array or {data: [...]} (also
 * {data: {data: [...]}}) and fail loudly on anything else.
 */
import { CloposUnexpectedResponseError } from './errors';

export type Json = Record<string, unknown>;

export function extractList(payload: unknown, what: string): Json[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (isObject(payload)) {
    const data = payload.data;
    if (Array.isArray(data)) return data.filter(isObject);
    if (isObject(data) && Array.isArray(data.data)) return data.data.filter(isObject);
  }
  throw new CloposUnexpectedResponseError(`${what}: expected a list`);
}

export function extractObject(payload: unknown, what: string): Json {
  if (isObject(payload)) {
    if (isObject(payload.data)) return payload.data;
    return payload;
  }
  throw new CloposUnexpectedResponseError(`${what}: expected an object`);
}

export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** ISO strings, "YYYY-MM-DD HH:mm:ss" (treated as UTC) or unix seconds/ms. */
export function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return date(Number(v));
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
