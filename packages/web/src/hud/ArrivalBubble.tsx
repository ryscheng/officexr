import { useEffect, useState } from 'react';
import type { PlayerId, Store } from '@officexr/sdk';

const ARRIVAL_BUBBLE_MS = 4000;

const firstName = (name: string) => name.trim().split(' ')[0];

/** Announces a player who joins, or finishes naming themselves, while the people sheet is closed. */
export function ArrivalBubble({ store, selfId, toast = false }: { store: Store; selfId: PlayerId; toast?: boolean }) {
  const [arrival, setArrival] = useState<{ name: string } | null>(null);
  useEffect(
    () =>
      store.subscribe(
        (s) => s.players,
        (next, prev) => {
          const arrived = Object.values(next).find((p) => p.id !== selfId && p.name.trim() && !prev[p.id]?.name.trim());
          if (arrived) {
            setArrival({ name: firstName(arrived.name) });
          }
        },
      ),
    [store, selfId],
  );
  useEffect(() => {
    const timer = setTimeout(() => setArrival(null), ARRIVAL_BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [arrival]);
  if (arrival && toast) {
    return (
      <div role="status" className="hud-glass flex items-center gap-2 rounded-full border border-hud-edge px-4 py-2 font-hud-body text-sm font-semibold whitespace-nowrap text-hud-text shadow-hud-panel">
        <span aria-hidden className="size-2 rounded-full bg-hud-accent" />
        {arrival.name} came in
      </div>
    );
  }
  return (
    !toast &&
    arrival && (
      <span className="rounded-hud-control bg-hud-accent px-2 py-1 font-hud-body text-xs whitespace-nowrap text-hud-on-accent">
        +1 {arrival.name}
      </span>
    )
  );
}
