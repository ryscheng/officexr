import { GAMEPLAY_CAMERA_MODES, type GameplayCameraMode } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';

const LABELS: Record<GameplayCameraMode, string> = {
  'first-person': 'First person',
  'third-person': 'Third person',
  fixed: 'Fixed',
};

export function CameraModeMenuItem({ value, onChange }: { value: CameraMode; onChange: (mode: CameraMode) => void }) {
  return (
    <fieldset>
      <legend className="px-3 pt-1 text-xs text-white/60">Camera</legend>
      {GAMEPLAY_CAMERA_MODES.map((mode) => (
        <label key={mode} className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-3 hover:bg-white/10">
          <input type="radio" name="camera-mode" checked={mode === value} onChange={() => onChange(mode)} />
          {LABELS[mode]}
        </label>
      ))}
    </fieldset>
  );
}
