import type { Bus } from '../bus.ts';
import type { Store } from '../store.ts';

/**
 * Maintains `state.proximity[selfId]` — the set of peers we consider
 * "in voice range" — driven by the four-stage proximity events:
 *
 *   - `proximity:entered` (inner-IN): add peer to the set.
 *   - `proximity:exited`  (outer-OUT): remove peer from the set.
 *
 * The hysteresis sits between these two: a peer who crosses inner outward
 * (`exiting`) stays in the set until they fully clear the outer band, so
 * voice rooms keep them attached for a moment of slack. `entering` and
 * `exiting` are visual-only signals here; they don't mutate state.
 */
export function attachProximityReducer(store: Store, bus: Bus): () => void {
  const offEntered = bus.on('proximity:entered', ({ otherId }) => {
    store.setState((s) => {
      const current = s.proximity[s.selfId] ?? new Set<string>();
      if (current.has(otherId)) return {};
      const next = new Set(current);
      next.add(otherId);
      return { proximity: { ...s.proximity, [s.selfId]: next } };
    });
  });

  const offExited = bus.on('proximity:exited', ({ otherId }) => {
    store.setState((s) => {
      const current = s.proximity[s.selfId];
      if (!current || !current.has(otherId)) return {};
      const next = new Set(current);
      next.delete(otherId);
      return { proximity: { ...s.proximity, [s.selfId]: next } };
    });
  });

  return () => {
    offEntered();
    offExited();
  };
}
