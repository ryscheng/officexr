import { useEffect, useSyncExternalStore } from 'react';
import { Ban } from 'lucide-react';
import { MAX_PLACED_PROPS, PLACEABLE_KINDS, type OfficeState, type Store } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { useStoreSelector } from '@officexr/world/top-down';
import type { BuildSession } from '../../place/buildSession';
import { Panel } from '../ui/Panel';

export const PLACED_TOAST_MS = 5000;
export const FULL_TEXT = 'This office is full of props. Remove one first.';

const selectPlacedCount = (s: OfficeState) => s.placedProps.length;

export function BuildStatus({ mode, build, store }: { mode: PlaceModeStore; build: BuildSession; store: Store }) {
  const { ghost, notice } = useSyncExternalStore(mode.subscribe, mode.get);
  const note = useSyncExternalStore(build.subscribe, build.last);
  const count = useStoreSelector(store, selectPlacedCount);
  const full = count >= MAX_PLACED_PROPS;
  const { dismiss } = build;
  useEffect(() => {
    if (!note) {
      return;
    }
    const timer = setTimeout(dismiss, PLACED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [note, dismiss]);
  const message = full ? FULL_TEXT : notice;
  return (
    <div className="flex flex-col items-center gap-2">
      {note && (
        <Panel role="status" className="pointer-events-auto flex items-center gap-1 py-1 pr-1 pl-4 text-sm font-semibold">
          <span>Placed {PLACEABLE_KINDS.find((k) => k.kindId === note.kindId)?.label}</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void build.undo()}
            className="min-h-12 rounded-hud-control px-4 text-sm font-semibold text-hud-accent-edge hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
          >
            Undo
          </button>
        </Panel>
      )}
      <div className="flex items-center gap-2">
        <span role="status" className="hud-glass rounded-full border border-hud-edge px-3 py-1.5 text-sm font-semibold text-hud-text shadow-hud-control">
          {count} of {MAX_PLACED_PROPS} props
        </span>
        {ghost && !ghost.valid && !full && (
          <span role="status" className="flex items-center gap-1.5 rounded-full bg-hud-rose px-3 py-1.5 text-sm font-semibold text-hud-rose-text">
            <Ban aria-hidden className="size-4" />
            Blocked
          </span>
        )}
      </div>
      {message && (
        <p role="status" className="max-w-72 text-center text-xs text-hud-rose-text">
          {message}
        </p>
      )}
    </div>
  );
}
