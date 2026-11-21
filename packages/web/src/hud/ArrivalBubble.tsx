import { useEffect, useState, type ReactNode } from 'react';
import type { PlayerId, Store } from '@officexr/sdk';

import { PortraitFace } from './PortraitFace';
import { usePlayerPortrait } from './playerPortrait';

const ARRIVAL_BUBBLE_MS = 4000;

function ArrivalFace({ id, className, fallback = null }: { id: PlayerId; className: string; fallback?: ReactNode }) {
  const portrait = usePlayerPortrait(id);
  return portrait ? (
    <span aria-hidden className={`relative shrink-0 rounded-full bg-hud-avatar ${className}`}>
      <PortraitFace src={portrait} initial="" />
    </span>
  ) : (
    fallback
  );
}

const firstName = (name: string) => name.trim().split(' ')[0];

/** Announces a player who joins, or finishes naming themselves, while the people sheet is closed. */
export function ArrivalBubble({ store, selfId, toast = false }: { store: Store; selfId: PlayerId; toast?: boolean }) {
  const [arrival, setArrival] = useState<{ id: PlayerId; name: string } | null>(null);
  useEffect(
    () =>
      store.subscribe(
        (s) => s.players,
        (next, prev) => {
          const arrived = Object.values(next).find((p) => p.id !== selfId && p.name.trim() && !prev[p.id]?.name.trim());
          if (arrived) {
            setArrival({ id: arrived.id, name: firstName(arrived.name) });
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
        <ArrivalFace id={arrival.id} className="size-5" fallback={<span aria-hidden className="size-2 rounded-full bg-hud-accent" />} />
        {arrival.name} came in
      </div>
    );
  }
  return (
    !toast &&
    arrival && (
      <span className="inline-flex items-center gap-1.5 rounded-hud-control bg-hud-accent px-2 py-1 font-hud-body text-xs whitespace-nowrap text-hud-on-accent">
        <ArrivalFace id={arrival.id} className="size-4" />
        +1 {arrival.name}
      </span>
    )
  );
}
