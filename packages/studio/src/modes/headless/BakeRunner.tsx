import React, { useEffect, useState } from 'react';
import { useApplication } from '@officexr/world/react';

/**
 * Programmatic bake runner.
 *
 * Mounted by HeadlessApp on `?op=bake`. Awaits the catalog bootstrap,
 * then calls `api.bake.measureAll()` and writes the result to
 * `window.officexrApi.bakeResults` so the Playwright driver can pick
 * it up via a single `page.evaluate`.
 *
 * No UI clicks; no DOM scraping; no race between Suspense and the
 * catalog. The page does ONE thing — measure the catalog — and exposes
 * the result for the script.
 */
export function BakeRunner() {
  const api = useApplication();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'measuring'; done: number; total: number }
    | { kind: 'done'; count: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await api.catalog.ready();
        const total = api.catalog.listKinds().filter(
          (k) => k.category !== 'character',
        ).length;
        setStatus({ kind: 'measuring', done: 0, total });
        const results = await api.bake.measureAll();
        if (cancelled) return;
        // Surface results via the same single getter Playwright uses
        // to reach the api itself.
        const win = window as unknown as {
          __officexrBakeResults?: Record<
            string,
            { width: number; height: number; depth: number } | null
          >;
          __officexrBakeDone?: boolean;
        };
        win.__officexrBakeResults = Object.fromEntries(results);
        win.__officexrBakeDone = true;
        setStatus({ kind: 'done', count: results.size });
      } catch (err) {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div
      data-bake-status={status.kind}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000',
        color: '#cfc',
        fontFamily: 'monospace',
        padding: 16,
      }}
    >
      <h1 style={{ color: '#fff' }}>Bake runner</h1>
      {status.kind === 'idle' && <p>Awaiting catalog…</p>}
      {status.kind === 'measuring' && (
        <p>
          Measuring {status.done}/{status.total}…
        </p>
      )}
      {status.kind === 'done' && (
        <p data-bake-count={status.count}>
          Done — measured {status.count} kinds. Results on
          `window.__officexrBakeResults`.
        </p>
      )}
      {status.kind === 'error' && (
        <p style={{ color: '#fcc' }}>Error: {status.message}</p>
      )}
    </div>
  );
}
