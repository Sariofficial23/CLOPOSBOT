import type { FetchLike } from '../auth';

export interface Call {
  url: string;
  init?: RequestInit;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Scripted fetch: each call consumes the next responder. */
export function scriptedFetch(responders: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const next = responders.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return next(call);
  };
  return { fetch: fn, calls };
}

export function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

export const CREDS = { clientId: 'cid', clientSecret: 'super-secret', brand: 'demo', integratorId: 'int-1' };
