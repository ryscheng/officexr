import { useCallback, useEffect, useRef, type DependencyList } from 'react';

const DEBOUNCE_MS = 500;

/**
 * Debounced autosave that never drops its last edit. `schedule(pending)`
 * replaces any earlier pending save and runs `save(pending)` 500 ms later;
 * `null` cancels (nothing to save). A save still pending when `flushOn`
 * changes or the component unmounts runs immediately, so `pending` must carry
 * everything `save` needs (target name, storage) and `save` must be stable.
 * `settled()` resolves once every save started so far has finished, so a
 * following load can't read a stale copy; it never rejects.
 */
export function useDebouncedSave<T>(
  save: (pending: T) => Promise<unknown> | void,
  flushOn: DependencyList,
): { schedule: (pending: T | null) => void; settled: () => Promise<void> } {
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (pending === null) {
      return;
    }
    pendingRef.current = null;
    inFlightRef.current = Promise.all([
      inFlightRef.current,
      Promise.resolve(save(pending)).catch(() => {}),
    ]).then(() => {});
  }, [save]);

  useEffect(() => flush, [flush, ...flushOn]);

  const schedule = useCallback(
    (pending: T | null) => {
      clearTimeout(timerRef.current);
      pendingRef.current = pending;
      if (pending !== null) {
        timerRef.current = setTimeout(flush, DEBOUNCE_MS);
      }
    },
    [flush],
  );
  const settled = useCallback(() => inFlightRef.current, []);

  return { schedule, settled };
}
