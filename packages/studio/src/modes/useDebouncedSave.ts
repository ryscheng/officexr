import { useCallback, useEffect, useRef, type DependencyList } from 'react';

const DEBOUNCE_MS = 500;

/**
 * Debounced autosave that never drops its last edit. Call the returned
 * `schedule(pending)` from an effect and return its result as that effect's
 * cleanup; `null` means nothing to save. It replaces any earlier pending save
 * and runs `save(pending)` after 500 ms. A save still pending when `flushOn`
 * changes or the component unmounts runs immediately, so `pending` must carry
 * everything `save` needs (target name, storage) and `save` must be stable.
 */
export function useDebouncedSave<T>(
  save: (pending: T) => void,
  flushOn: DependencyList,
): (pending: T | null) => (() => void) | undefined {
  const pendingRef = useRef<T | null>(null);
  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending === null) {
      return;
    }
    pendingRef.current = null;
    save(pending);
  }, [save]);

  useEffect(() => flush, [flush, ...flushOn]);

  return useCallback(
    (pending) => {
      pendingRef.current = pending;
      if (pending === null) {
        return undefined;
      }
      const t = setTimeout(flush, DEBOUNCE_MS);
      return () => clearTimeout(t);
    },
    [flush],
  );
}
