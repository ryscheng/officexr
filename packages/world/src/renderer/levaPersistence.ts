import { useEffect } from 'react';
import { levaStore } from 'leva';

const STORAGE_KEY = 'officexr.debug-app.leva';
/** Debounce window for writing changes to localStorage. Avoids hammering it
 * while a slider is being dragged. */
const FLUSH_MS = 250;

type LevaItem = { value?: unknown };

function collectValues(): Record<string, unknown> {
  const data = levaStore.getData() as Record<string, LevaItem>;
  const out: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(data)) {
    if (item && typeof item === 'object' && 'value' in item) {
      out[path] = item.value;
    }
  }
  return out;
}

function applyValues(values: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(values)) {
    try {
      levaStore.setValueAtPath(path, value, false);
    } catch {
      // Schema may have changed (e.g. a slider was renamed). Skip.
    }
  }
}

/**
 * Persist every Leva control's value to localStorage. Hydrates on mount,
 * then writes (debounced) on every store change. Returns an unsubscribe.
 */
export function useLevaPersistence(): void {
  useEffect(() => {
    // 1) Hydrate from localStorage. Skip the writes that this triggers.
    let hydrating = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        applyValues(JSON.parse(saved) as Record<string, unknown>);
      } catch (err) {
        console.warn('[leva] hydrate failed:', err);
      }
    }
    queueMicrotask(() => {
      hydrating = false;
    });

    // 2) Debounced writer.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      pending = null;
      try {
        const values = collectValues();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
      } catch (err) {
        console.warn('[leva] persist failed:', err);
      }
    };
    const schedule = () => {
      if (hydrating) return;
      if (pending !== null) return;
      pending = setTimeout(flush, FLUSH_MS);
    };

    // 3) Subscribe to every store change. The zustand `useStore.subscribe`
    //    fires on every state mutation (drag step, button click, programmatic
    //    update). The 250 ms debounce coalesces drag-stream writes.
    const unsubscribe = levaStore.useStore.subscribe(schedule);

    return () => {
      unsubscribe();
      if (pending !== null) {
        clearTimeout(pending);
        flush();
      }
    };
  }, []);
}

/** Trigger a JSON file download containing every Leva control's current value. */
export function exportLevaConfig(): void {
  const json = JSON.stringify(collectValues(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `debug-app-config-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Drop persisted values and reload so all controls return to defaults. */
export function resetLevaConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
