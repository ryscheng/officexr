import { useEffect, useState } from 'react';
import type { Bus, PlayerId, Store } from '@officexr/sdk';
import { senderName } from '../ping/senderName';

export const POKE_TOAST_MS = 2500;

export function PokeToast({ bus, store, selfId }: { bus: Bus; store: Store; selfId: PlayerId }) {
  const [poke, setPoke] = useState<{ poker: string } | null>(null);

  useEffect(
    () =>
      bus.on('poke:received', ({ fromId, targetId }) => {
        if (targetId === selfId && fromId !== selfId && !store.getState().players[selfId]?.focus) {
          setPoke({ poker: senderName(store, fromId) });
        }
      }),
    [bus, store, selfId],
  );

  useEffect(() => {
    if (poke === null) {
      return;
    }
    const id = setTimeout(() => setPoke(null), POKE_TOAST_MS);
    return () => clearTimeout(id);
  }, [poke]);

  return (
    <div role="status">
      {poke !== null && (
        <div className="rounded-hud-control bg-hud-amber px-4 py-2 text-center font-hud-body text-sm font-semibold text-hud-amber-text shadow-hud-control">
          Poked by {poke.poker}
        </div>
      )}
    </div>
  );
}
