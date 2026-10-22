import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';

/** `select` and `equals` must be stable (module-level); the snapshot keeps its identity while `equals` holds. */
export function useStoreSelector<T>(
  store: Store,
  select: (s: OfficeState) => T,
  equals: (a: T, b: T) => boolean = Object.is,
): T {
  const last = useRef<{ value: T } | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => store.subscribe(select, notify, equals),
    [store, select, equals],
  );
  const getSnapshot = useCallback(() => {
    const next = select(store.getState());
    if (!last.current || !equals(last.current.value, next)) {
      last.current = { value: next };
    }
    return last.current.value;
  }, [store, select, equals]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
