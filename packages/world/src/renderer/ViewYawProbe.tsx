import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ViewYaw } from '../react/viewYaw.tsx';
import { yawFromDirection } from './lookControls.ts';

const direction = new THREE.Vector3();

/** Mount after `CameraRig` so it reads this frame's pose, not last frame's. */
export function ViewYawProbe({ viewYaw }: { viewYaw: ViewYaw }) {
  useFrame(({ gl, camera }) => {
    const active = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    viewYaw.set(yawFromDirection(active.getWorldDirection(direction)));
  });
  return null;
}
