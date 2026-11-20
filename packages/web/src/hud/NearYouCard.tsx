import { Hand, MessageCircle } from 'lucide-react';
import type { OfficeState, PlayerId, PresenceStatus, Store } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import { planarDistance, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import { formatDistance } from './formatDistance';
import { PRESENCE_INDICATOR } from './presenceColours';
import { sameFields } from './sameFields';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';
import { useNow } from './useNow';

export const NEAR_RANGE_M = 8;

type Near = { id: PlayerId; name: string; status: PresenceStatus; distanceM: number };

const selectNearest = (s: OfficeState): (Near & { lastStatusAt?: number; firstSeenAt?: number }) | null => {
  const me = s.players[s.selfId];
  if (!me) {
    return null;
  }
  let best: (Near & { lastStatusAt?: number; firstSeenAt?: number }) | null = null;
  for (const p of Object.values(s.players)) {
    if (p.id === s.selfId || !p.name.trim()) {
      continue;
    }
    const d = planarDistance(me.pos, p.pos);
    if (d <= NEAR_RANGE_M && (!best || d < best.distanceM)) {
      best = { id: p.id, name: p.name, status: p.status, lastStatusAt: p.lastStatusAt, firstSeenAt: p.firstSeenAt, distanceM: d };
    }
  }
  return best && { ...best, distanceM: Math.floor(best.distanceM) };
};
const sameNear = (a: ReturnType<typeof selectNearest>, b: ReturnType<typeof selectNearest>) => (a && b ? sameFields(a, b) : a === b);

export function NearYouCard({ store, onWave }: { store: Store; onWave: () => void }) {
  const near = useStoreSelector(store, selectNearest, sameNear);
  const now = useNow(1000);
  const { goTo } = usePlayControls();
  if (!near) {
    return null;
  }
  const presence = PRESENCE_INDICATOR[presenceIndicator(near, now)];
  return (
    <Panel className="pointer-events-auto flex w-86 max-w-[calc(100vw-24px)] flex-col gap-2.5 p-3 pointer-coarse:hidden" role="region" aria-label="Near you">
      <h2 className="text-[11px] font-semibold tracking-widest text-hud-text-2 uppercase">Near you</h2>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-hud-avatar text-sm font-semibold">
          {near.name.charAt(0).toUpperCase()}
          <span className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-hud-panel-solid ${presence.dot}`} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{near.name}</span>
        <span className="shrink-0 text-xs text-hud-text-2">
          {presence.label} · {formatDistance(near.distanceM)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => goTo(near.id)}>
          <MessageCircle aria-hidden className="size-4" />
          Speak
        </Button>
        <Button onClick={onWave}>
          <Hand aria-hidden className="size-4" />
          Wave
        </Button>
      </div>
    </Panel>
  );
}

export function NearYouButtons({ store, onWave }: { store: Store; onWave: () => void }) {
  const near = useStoreSelector(store, selectNearest, sameNear);
  const { goTo } = usePlayControls();
  if (!near) {
    return null;
  }
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1">
      <span className="hud-glass rounded-full px-2.5 py-0.5 text-xs text-hud-text">
        {near.name} · {formatDistance(near.distanceM)}
      </span>
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onWave}
          className="hud-glass mb-10 flex size-16 flex-col items-center justify-center gap-0.5 rounded-full border border-hud-edge text-xs font-semibold text-hud-text shadow-hud-panel"
        >
          <Hand aria-hidden className="size-5" />
          Wave
        </button>
        <button
          type="button"
          onClick={() => goTo(near.id)}
          className="flex size-18 flex-col items-center justify-center gap-0.5 rounded-full bg-hud-accent text-sm font-semibold text-hud-on-accent shadow-[0_4px_16px_var(--color-hud-accent-shadow)]"
        >
          <MessageCircle aria-hidden className="size-6" />
          Speak
        </button>
      </div>
    </div>
  );
}
