import { useEffect, useState } from 'react';

export type ApiState<T> = { type: 'loading' } | { type: 'ready'; data: T } | { type: 'error'; message: string };

export function useApi<T>(url: string): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ type: 'loading' });
  useEffect(() => {
    setState({ type: 'loading' });
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        return res.ok
          ? { type: 'ready' as const, data: body as T }
          : { type: 'error' as const, message: body?.error ?? `HTTP ${res.status}` };
      })
      .catch((err: Error) => ({ type: 'error' as const, message: err.message }))
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}
