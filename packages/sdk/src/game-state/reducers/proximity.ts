import type { Bus } from '../bus.ts';
import type { Store } from '../store.ts';

export function attachProximityReducer(store: Store, bus: Bus): () => void {
  const offEntering = bus.on('proximity:entering', ({ otherId }) => {
    store.setState((s) => {
      const current = s.proximity[s.selfId] ?? new Set<string>();
      if (current.has(otherId)) return {};
      const next = new Set(current);
      next.add(otherId);
      return { proximity: { ...s.proximity, [s.selfId]: next } };
    });
  });

  const offExiting = bus.on('proximity:exiting', ({ otherId }) => {
    store.setState((s) => {
      const current = s.proximity[s.selfId];
      if (!current || !current.has(otherId)) return {};
      const next = new Set(current);
      next.delete(otherId);
      return { proximity: { ...s.proximity, [s.selfId]: next } };
    });
    bus.emit({ kind: 'proximity:exited', otherId });
  });

  return () => {
    offEntering();
    offExiting();
  };
}
