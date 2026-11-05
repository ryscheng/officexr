import type { ViewMode } from '@officexr/sdk';
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
  const next: ViewMode = mode === '2d' ? '3d' : '2d';
  const unavailable = gpu === 'none';
  return (
    <>
      <button
        type="button"
        disabled={unavailable}
        onClick={() => {
          storeViewMode(next);
          reload();
        }}
        className="block w-full rounded px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {next === '2d' ? '2D view' : '3D view'}
      </button>
      {unavailable && (
        <p role="status" className="px-3 pb-1 text-xs text-white/60">
          3D needs WebGL, which this browser doesn't offer
        </p>
      )}
    </>
  );
}
