import { GAMEPLAY_CAMERA_MODES } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';

const LABELS: Partial<Record<CameraMode, string>> = {
  'first-person': 'First person',
  'third-person': 'Third person',
  fixed: 'Fixed',
};

export function CameraModeMenuItem({ value, onChange }: { value: CameraMode; onChange: (mode: CameraMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Camera mode">
      <div className="px-3 pt-1 text-xs text-white/60">Camera</div>
      {GAMEPLAY_CAMERA_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(mode)}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-white/10"
        >
          <span aria-hidden className="w-3">
            {mode === value ? '●' : '○'}
          </span>
          {LABELS[mode] ?? mode}
        </button>
      ))}
    </div>
  );
}
