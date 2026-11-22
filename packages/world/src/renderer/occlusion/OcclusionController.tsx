import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { feetPosition } from '../../physics/rules.ts';
import type { CameraMode } from '../config.ts';
import { useOccluderRegistry } from './OccluderContext.tsx';
import type { CoverProbe } from './OccluderRegistry.ts';

const HEAD_HEIGHT = 1.55;
const CHEST_HEIGHT = 1.0;
const FRAMES_PER_QUERY = 2;

interface OcclusionMarker {
  fading: number;
  cutaway: number;
}

interface OcclusionControllerProps {
  mode: CameraMode;
  playerPosRef: React.RefObject<THREE.Vector3>;
  charRadius: number;
  enabled: boolean;
}

// Must run after CameraRig, which sets the camera pose the line of sight starts from.
export function OcclusionController({ mode, playerPosRef, charRadius, enabled }: OcclusionControllerProps) {
  const registry = useOccluderRegistry();
  const { camera, gl } = useThree();
  const head = useRef(new THREE.Vector3());
  const chest = useRef(new THREE.Vector3());
  const targets = useRef([head.current, chest.current]);
  const cover = useRef<CoverProbe>({ x: 0, feetY: 0, z: 0 });
  const frame = useRef(0);
  const fades = enabled && (mode === 'fixed' || mode === 'third-person');
  const cutsAway = fades && mode === 'fixed';

  useEffect(() => {
    if (!fades) registry?.restoreAll();
    return () => registry?.restoreAll();
  }, [registry, fades]);

  useFrame((_, dtSec) => {
    const pos = playerPosRef.current;
    if (!registry || !fades || !pos || gl.xr.isPresenting) return;
    const feet = feetPosition(pos, charRadius);
    head.current.set(feet.x, feet.y + HEAD_HEIGHT, feet.z);
    chest.current.set(feet.x, feet.y + CHEST_HEIGHT, feet.z);
    const query = frame.current++ % FRAMES_PER_QUERY === 0;

    cover.current.x = feet.x;
    cover.current.feetY = feet.y;
    cover.current.z = feet.z;
    registry.updateFades(camera.position, targets.current, dtSec, query, cutsAway ? cover.current : null);
    if (query) {
      (globalThis as unknown as { __OFFICE_OCCLUSION__?: OcclusionMarker }).__OFFICE_OCCLUSION__ = {
        fading: registry.fadedCount(),
        cutaway: registry.cutCount(),
      };
    }
  });

  return null;
}
