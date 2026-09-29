'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

/** Fetch a backend resource; re-fetches when `key` changes. */
export function useApi<T>(path: string | null, query?: Record<string, string | number | boolean | undefined | null>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path, { query: queryRef.current, signal }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(errorText(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return { data, error, loading, reload: () => load() };
}
