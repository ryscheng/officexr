import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { feetPosition } from '../../physics/rules.ts';
import type { CameraMode } from '../config.ts';
import { useOccluderRegistry } from './OccluderContext.tsx';
import { easedDistance, pulledInDistance } from './occlusionMath.ts';

const HEAD_HEIGHT = 1.55;
const CHEST_HEIGHT = 1.0;
const FRAMES_PER_QUERY = 2;

interface OcclusionMarker {
  fading: number;
  cameraPulledIn: boolean;
  cameraDistance: number | null;
}

interface OcclusionControllerProps {
  mode: CameraMode;
  playerPosRef: React.RefObject<THREE.Vector3>;
  charRadius: number;
  enabled: boolean;
}

// Must run after CameraRig, which sets the camera pose adjusted here.
export function OcclusionController({ mode, playerPosRef, charRadius, enabled }: OcclusionControllerProps) {
  const registry = useOccluderRegistry();
  const { camera, gl } = useThree();
  const head = useRef(new THREE.Vector3());
  const chest = useRef(new THREE.Vector3());
  const toCamera = useRef(new THREE.Vector3());
  const targets = useRef([head.current, chest.current]);
  const frame = useRef(0);
  const distance = useRef<number | null>(null);
  const targetDistance = useRef(0);
  const desiredDistance = useRef(0);
  const fades = enabled && (mode === 'fixed' || mode === 'third-person');
  const pullsIn = enabled && mode === 'third-person';

  useEffect(() => {
    if (!fades) registry?.restoreAll();
    return () => registry?.restoreAll();
  }, [registry, fades]);

  useEffect(() => {
    distance.current = null;
  }, [pullsIn]);

  useFrame((_, dtSec) => {
    const pos = playerPosRef.current;
    if (!registry || !fades || !pos || gl.xr.isPresenting) return;
    const feet = feetPosition(pos, charRadius);
    head.current.set(feet.x, feet.y + HEAD_HEIGHT, feet.z);
    chest.current.set(feet.x, feet.y + CHEST_HEIGHT, feet.z);
    const query = frame.current++ % FRAMES_PER_QUERY === 0;

    if (pullsIn) {
      toCamera.current.copy(camera.position).sub(head.current);
      const desired = toCamera.current.length();
      desiredDistance.current = desired;
      if (desired > 1e-3) {
        if (query || distance.current === null) {
          const hit = registry.firstHit(head.current, camera.position);
          targetDistance.current = pulledInDistance(desired, hit);
        }
        const target = Math.min(targetDistance.current, desired);
        distance.current = easedDistance(distance.current ?? desired, target, dtSec);
        const shown = Math.min(distance.current, desired);
        camera.position.copy(head.current).addScaledVector(toCamera.current, shown / desired);
      }
    }

    registry.updateFades(camera.position, targets.current, dtSec, query);
    if (query) {
      (globalThis as unknown as { __OFFICE_OCCLUSION__?: OcclusionMarker }).__OFFICE_OCCLUSION__ = {
        fading: registry.fadedCount(),
        cameraPulledIn: pullsIn && distance.current !== null ? targetDistance.current < desiredDistance.current - 0.05 : false,
        cameraDistance: pullsIn ? camera.position.distanceTo(head.current) : null,
      };
    }
  });

  return null;
}
