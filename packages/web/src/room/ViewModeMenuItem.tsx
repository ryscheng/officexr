import { useId } from 'react';
import type { ViewMode } from '@officexr/sdk';
import { RoomMenuItem } from './RoomMenu';
import { storeViewMode, type GpuSupport } from './viewMode';

/** Switches to the other view and reloads, which rejoins the room in it. */
export function ViewModeMenuItem({
  mode,
  gpu,
  reload = () => window.location.reload(),
}: {
  mode: ViewMode;
  gpu: GpuSupport;
  reload?: () => void;
}) {
  const reasonId = useId();
  const next: ViewMode = mode === '2d' ? '3d' : '2d';
  const unavailable = gpu === 'none';
  return (
    <>
      <RoomMenuItem
        disabled={unavailable}
        describedBy={unavailable ? reasonId : undefined}
        onSelect={() => {
          storeViewMode(next);
          reload();
        }}
      >
        {next === '2d' ? '2D view' : '3D view'}
      </RoomMenuItem>
      {unavailable && (
        <p id={reasonId} className="px-3 pb-1 text-xs text-white/60">
          3D needs WebGL, which this browser doesn't offer
        </p>
      )}
    </>
  );
}
