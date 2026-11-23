import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { feetPosition } from '../physics/rules.ts';
import { CHAR_HEIGHT_M } from './config.ts';

export interface CameraProbe {
  /** The local player's chest in normalised device coordinates of the active camera, or null before the first frame. */
  selfNdc: () => { x: number; y: number } | null;
}

export function useCameraProbe(playerPosRef: React.RefObject<THREE.Vector3>, charRadius: number): void {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const point = new THREE.Vector3();
    const probe: CameraProbe = {
      selfNdc: () => {
        const pos = playerPosRef.current;
        if (!pos) {
          return null;
        }
        const feet = feetPosition(pos, charRadius);
        camera.updateMatrixWorld();
        point.set(feet.x, feet.y + CHAR_HEIGHT_M / 2, feet.z).project(camera);
        return { x: point.x, y: point.y };
      },
    };
    const target = globalThis as unknown as { __OFFICE_CAMERA__?: CameraProbe };
    target.__OFFICE_CAMERA__ = probe;
    return () => {
      delete target.__OFFICE_CAMERA__;
    };
  }, [camera, playerPosRef, charRadius]);
}
