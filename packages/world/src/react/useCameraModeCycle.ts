import { useEffect, useState } from 'react';
import { CAMERA_MODES, type CameraMode } from '../renderer/config.ts';

// 'top-down' and 'free-fly' belong to the Scenes editor.
const CYCLEABLE: readonly CameraMode[] = CAMERA_MODES.filter((m) => m !== 'top-down' && m !== 'free-fly');

/** The gameplay camera mode, cycled with Alt+P. */
export function useCameraModeCycle(): CameraMode {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        setCameraMode((current) => CYCLEABLE[(CYCLEABLE.indexOf(current) + 1) % CYCLEABLE.length]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return cameraMode;
}
