import type { ViewMode } from '@officexr/sdk';
import { RoomMenuItem } from './RoomMenu';
import { storeViewMode } from './viewMode';

/** Switches to the other view and reloads, which rejoins the room in it. */
export function ViewModeMenuItem({ mode, reload = () => window.location.reload() }: { mode: ViewMode; reload?: () => void }) {
  const next: ViewMode = mode === '2d' ? '3d' : '2d';
  return (
    <RoomMenuItem
      onSelect={() => {
        storeViewMode(next);
        reload();
      }}
    >
      {next === '2d' ? '2D view' : '3D view'}
    </RoomMenuItem>
  );
}
