import { useSyncExternalStore } from 'react';
import { Hammer } from 'lucide-react';
import { PLACEABLE_KINDS } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { Keycap } from './ui/Keycap';
import { Panel } from './ui/Panel';

const HINTS = [
  ['Tab', 'next prop'],
  ['R', 'rotate'],
  ['Enter', 'place'],
  ['B', 'close'],
] as const;

export function BuildIndicator({ mode }: { mode: PlaceModeStore }) {
  const { open, kindId, notice } = useSyncExternalStore(mode.subscribe, mode.get);
  if (!open) {
    return null;
  }
  const label = PLACEABLE_KINDS.find((k) => k.kindId === kindId)?.label ?? kindId;
  return (
    <Panel role="status" aria-label="Build mode" className="pointer-events-none flex max-w-[calc(100vw-24px)] flex-col items-center gap-1.5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Hammer aria-hidden className="size-4 shrink-0" />
        <span>Building</span>
        <span className="text-hud-text-2">·</span>
        <span className="truncate">{label}</span>
      </div>
      <ul aria-label="Build keys" className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-hud-text-2 pointer-coarse:hidden">
        {HINTS.map(([key, action]) => (
          <li key={key} className="flex items-center gap-1.5">
            <Keycap>{key}</Keycap>
            {action}
          </li>
        ))}
      </ul>
      {notice && <p className="text-xs text-hud-rose-text">{notice}</p>}
    </Panel>
  );
}
