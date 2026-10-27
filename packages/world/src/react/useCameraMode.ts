import { useEffect, useEffectEvent, useState } from 'react';
import { CAMERA_MODES, type CameraMode } from '../renderer/config.ts';

// 'top-down' and 'free-fly' belong to the Scenes editor.
export type GameplayCameraMode = Exclude<CameraMode, 'top-down' | 'free-fly'>;

export const GAMEPLAY_CAMERA_MODES: readonly GameplayCameraMode[] = CAMERA_MODES.filter(
  (m): m is GameplayCameraMode => m !== 'top-down' && m !== 'free-fly',
);

const nextMode = (current: CameraMode): CameraMode => {
  const modes: readonly CameraMode[] = GAMEPLAY_CAMERA_MODES;
  return modes[(modes.indexOf(current) + 1) % modes.length];
};

/**
 * The gameplay camera mode, cycled with Alt+P; starts on 'fixed'. Given a `value` it is
 * controlled: Alt+P calls `onChange` and the caller owns the mode.
 */
export function useCameraMode({ value, onChange }: { value?: CameraMode; onChange?: (mode: CameraMode) => void } = {}): CameraMode {
  const [local, setLocal] = useState<CameraMode>('fixed');
  const onAltP = useEffectEvent(() => {
    if (value === undefined) {
      setLocal(nextMode);
    } else {
      onChange?.(nextMode(value));
    }
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        onAltP();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return value ?? local;
}
