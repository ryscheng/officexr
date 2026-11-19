import { useEffect, useState } from 'react';
import type { Bus, PlayerId, Store } from '@officexr/sdk';
import { senderName } from '../ping/senderName';

export const POKE_TOAST_MS = 2500;

/** Shows "poked by <name>" for a moment whenever another player's poke lands on the local player. */
export function PokeToast({ bus, store, selfId }: { bus: Bus; store: Store; selfId: PlayerId }) {
  const [poker, setPoker] = useState<string | null>(null);

  useEffect(
    () =>
      bus.on('poke:received', ({ fromId, targetId }) => {
        if (targetId === selfId && fromId !== selfId) {
          setPoker(senderName(store, fromId));
        }
      }),
    [bus, store, selfId],
  );

  useEffect(() => {
    if (poker === null) {
      return;
    }
    const id = setTimeout(() => setPoker(null), POKE_TOAST_MS);
    return () => clearTimeout(id);
  }, [poker]);

  return (
    <div role="status">
      {poker !== null && (
        <div className="rounded-hud-control bg-hud-amber px-4 py-2 text-center font-hud-body text-sm font-semibold text-hud-amber-text shadow-hud-control">
          Poked by {poker}
        </div>
      )}
    </div>
  );
}
