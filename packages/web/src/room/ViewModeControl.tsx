import type { ViewMode } from '@officexr/sdk';
import { SegmentedControl } from '../hud/ui/SegmentedControl';
import { storeViewMode } from './viewMode';

const OPTIONS: readonly { value: ViewMode; label: string }[] = [
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
];

/** Choosing the other view stores it and reloads, which rejoins the room in it. */
export function ViewModeControl({
  mode,
  reload = () => window.location.reload(),
}: {
  mode: ViewMode;
  reload?: () => void;
}) {
  return (
    <SegmentedControl
      aria-label="View"
      value={mode}
      options={OPTIONS}
      onValueChange={(next) => {
        storeViewMode(next);
        reload();
      }}
    />
  );
}
