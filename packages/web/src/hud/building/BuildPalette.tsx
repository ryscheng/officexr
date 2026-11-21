import { useSyncExternalStore } from 'react';
import { Box } from 'lucide-react';
import { PLACEABLE_KINDS } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { Panel } from '../ui/Panel';

const POSITION = {
  portrait: 'inset-x-1 bottom-[126px]',
  landscape: 'bottom-0 left-1/2 w-[340px] -translate-x-1/2',
  desktop: 'bottom-0 left-1/2 w-[420px] -translate-x-1/2',
} as const;

export function BuildPalette({ mode, layout }: { mode: PlaceModeStore; layout: keyof typeof POSITION }) {
  const { kindId } = useSyncExternalStore(mode.subscribe, mode.get);
  return (
    <Panel role="radiogroup" aria-label="Props" className={`pointer-events-auto absolute flex h-24 items-center gap-2 overflow-hidden px-2.5 py-2 ${POSITION[layout]}`}>
      {PLACEABLE_KINDS.map((kind) => {
        const selected = kind.kindId === kindId;
        return (
          <button
            key={kind.kindId}
            type="button"
            role="radio"
            aria-checked={selected}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => mode.selectKind(kind.kindId)}
            className="flex min-w-12 flex-1 flex-col items-center gap-1 focus-visible:outline-2 focus-visible:outline-hud-accent"
          >
            <span className={`flex size-12 items-center justify-center rounded-hud-control ${selected ? 'bg-hud-accent-fill text-hud-on-accent outline-3 outline-hud-accent-fill' : 'bg-hud-inset text-hud-text'}`}>
              <Box aria-hidden className="size-6" />
            </span>
            <span className="h-7 text-center text-xs leading-[14px] font-semibold text-hud-text">{kind.label}</span>
          </button>
        );
      })}
    </Panel>
  );
}
