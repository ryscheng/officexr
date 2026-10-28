import { GAMEPLAY_CAMERA_MODES, type GameplayCameraMode } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';
import { RoomMenuChoice } from './RoomMenu';

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
        <RoomMenuChoice key={mode}>
          <input type="radio" name="camera-mode" checked={mode === value} onChange={() => onChange(mode)} />
          {LABELS[mode]}
        </RoomMenuChoice>
      ))}
    </fieldset>
  );
}
