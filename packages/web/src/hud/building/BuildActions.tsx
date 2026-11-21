import { useSyncExternalStore } from 'react';
import { Check, RotateCw } from 'lucide-react';
import { MAX_PLACED_PROPS, type OfficeState, type Store } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { useStoreSelector } from '@officexr/world/top-down';

const selectPlacedCount = (s: OfficeState) => s.placedProps.length;
const selectLive = (s: OfficeState) => s.realtime.status === 'live';

export function canPlace(ghostValid: boolean, count: number, live: boolean) {
  return ghostValid && count < MAX_PLACED_PROPS && live;
}

export function BuildActions({ mode, store }: { mode: PlaceModeStore; store: Store }) {
  const { ghost } = useSyncExternalStore(mode.subscribe, mode.get);
  const count = useStoreSelector(store, selectPlacedCount);
  const live = useStoreSelector(store, selectLive);
  const ready = canPlace(ghost?.valid ?? false, count, live);
  return (
    <div className="pointer-events-auto flex items-end gap-3">
      <button
        type="button"
        aria-label="Rotate"
        onMouseDown={(e) => e.preventDefault()}
        onClick={mode.rotate}
        className="hud-glass flex size-16 items-center justify-center rounded-full border border-hud-edge text-hud-text shadow-hud-panel hover:bg-hud-panel-thick focus-visible:outline-2 focus-visible:outline-hud-accent"
      >
        <RotateCw aria-hidden className="size-6" />
      </button>
      <button
        type="button"
        aria-label="Place"
        disabled={!ready}
        onMouseDown={(e) => e.preventDefault()}
        onClick={mode.place}
        className="flex size-18 flex-col items-center justify-center rounded-full bg-hud-accent-fill text-xs font-semibold text-hud-on-accent shadow-[0_1px_3px_var(--color-hud-accent-shadow)] hover:bg-hud-accent-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent disabled:opacity-40"
      >
        <Check aria-hidden className="size-6" />
        Place
      </button>
    </div>
  );
}
