import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { MAX_PLACED_PROPS, PLACEABLE_KINDS, type Store } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { focusWorld, useStoreSelector } from '@officexr/world/top-down';
import { Button } from '../hud/ui/Button';
import { Keycap } from '../hud/ui/Keycap';
import { Panel, PanelTitle } from '../hud/ui/Panel';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

const HINTS: readonly { keys: string; text: string }[] = [
  { keys: 'Enter or click', text: 'Place' },
  { keys: 'R', text: 'Turn the preview' },
  { keys: 'Tab', text: 'Next prop' },
  { keys: 'T', text: 'Turn the prop you point at' },
  { keys: 'G', text: 'Pick it up to move it' },
  { keys: 'Delete', text: 'Remove it' },
];

/** B opens and closes place mode, unless a text field or a dialog has the keyboard. */
export function usePlaceHotkey(mode: PlaceModeStore, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isHotkeyBlocked(e)) {
        return;
      }
      mode.setOpen(!mode.get().open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, enabled]);
}

export function PlaceButton({ mode }: { mode: PlaceModeStore }) {
  const open = useSyncExternalStore(mode.subscribe, () => mode.get().open);
  return (
    <Button
      size="sm"
      tone={open ? 'primary' : 'neutral'}
      aria-pressed={open}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        mode.setOpen(!open);
        focusWorld();
      }}
      className="pointer-events-auto"
    >
      Build <Keycap>B</Keycap>
    </Button>
  );
}

/** The kind palette, key hints and notices of place mode; renders nothing while it is closed. */
export function PlacePalette({ mode, store }: { mode: PlaceModeStore; store: Store }) {
  const state = useSyncExternalStore(mode.subscribe, mode.get);
  const count = useStoreSelector(store, (s) => s.placedProps.length);
  if (!state.open) {
    return null;
  }
  const status: ReactNode = state.notice ?? (state.ghost && !state.ghost.valid ? 'No room for it here.' : null);
  return (
    <Panel className="pointer-events-auto flex w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-2 p-3" role="region" aria-label="Build mode">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle>Build</PanelTitle>
        <span className="text-xs text-hud-text-2">
          {count} / {MAX_PLACED_PROPS} props
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Prop">
        {PLACEABLE_KINDS.map(({ kindId, label }) => (
          <Button
            key={kindId}
            size="sm"
            tone={state.kindId === kindId ? 'primary' : 'neutral'}
            aria-pressed={state.kindId === kindId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              mode.selectKind(kindId);
              focusWorld();
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-hud-text-2">
        {HINTS.map(({ keys, text }) => (
          <li key={keys} className="flex items-center gap-1.5">
            <Keycap>{keys}</Keycap>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p role="status" className="min-h-4 text-xs font-medium text-hud-text">
        {status}
      </p>
    </Panel>
  );
}
