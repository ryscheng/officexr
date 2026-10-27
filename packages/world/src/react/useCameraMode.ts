import { useEffect, useState } from 'react';
import { CAMERA_MODES, type CameraMode } from '../renderer/config.ts';

// 'top-down' and 'free-fly' belong to the Scenes editor.
export const GAMEPLAY_CAMERA_MODES: readonly CameraMode[] = CAMERA_MODES.filter(
  (m) => m !== 'top-down' && m !== 'free-fly',
);

export interface UseCameraModeOptions {
  /** Makes the hook controlled: the caller owns the mode and Alt+P reports through `onChange`. */
  value?: CameraMode;
  onChange?: (mode: CameraMode) => void;
}

/** The gameplay camera mode, cycled with Alt+P; starts on 'fixed' unless controlled. */
export function useCameraMode({ value, onChange }: UseCameraModeOptions = {}): CameraMode {
  const [local, setLocal] = useState<CameraMode>('fixed');
  const cameraMode = value ?? local;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        const next = GAMEPLAY_CAMERA_MODES[(GAMEPLAY_CAMERA_MODES.indexOf(cameraMode) + 1) % GAMEPLAY_CAMERA_MODES.length];
        if (value === undefined) {
          setLocal(next);
        }
        onChange?.(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cameraMode, value, onChange]);
  return cameraMode;
}
