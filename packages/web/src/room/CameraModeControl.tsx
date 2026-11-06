import { GAMEPLAY_CAMERA_MODES, type GameplayCameraMode } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';
import { SegmentedControl } from '../hud/ui/SegmentedControl';

const LABELS: Record<GameplayCameraMode, string> = {
  'first-person': 'First person',
  'third-person': 'Third person',
  fixed: 'Fixed',
};

const OPTIONS = GAMEPLAY_CAMERA_MODES.map((mode) => ({ value: mode, label: LABELS[mode] }));

export function CameraModeControl({ value, onChange }: { value: CameraMode; onChange: (mode: CameraMode) => void }) {
  return <SegmentedControl<CameraMode> aria-label="Camera" value={value} options={OPTIONS} onValueChange={onChange} />;
}
