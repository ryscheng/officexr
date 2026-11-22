import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createCharacterSilhouette, type CharacterSilhouette } from './characterSilhouette.ts';

export interface SilhouetteSpec {
  color: string;
  enabled: boolean;
  viewerRef?: RefObject<THREE.Vector3>;
  range?: number;
}

const CHECK_EVERY_FRAMES = 6;
const world = new THREE.Vector3();

export function withinRange(dx: number, dz: number, range: number): boolean {
  return dx * dx + dz * dz <= range * range;
}

export function useCharacterSilhouette(scene: THREE.Object3D, spec: SilhouetteSpec | null | undefined): void {
  const handle = useRef<CharacterSilhouette | null>(null);
  const frame = useRef(0);
  const enabled = spec?.enabled ?? false;
  const color = spec?.color ?? '#ffffff';
  const gated = spec?.viewerRef !== undefined;

  useEffect(() => {
    if (!enabled) return;
    const silhouette = createCharacterSilhouette(scene, color);
    handle.current = silhouette;
    silhouette.setVisible(!gated);
    return () => {
      silhouette.dispose();
      handle.current = null;
    };
  }, [scene, enabled, gated, color]);

  useFrame(() => {
    const silhouette = handle.current;
    const viewer = spec?.viewerRef?.current;
    if (!silhouette || !viewer || spec?.range === undefined) return;
    if (frame.current++ % CHECK_EVERY_FRAMES !== 0) return;
    scene.getWorldPosition(world);
    silhouette.setVisible(withinRange(world.x - viewer.x, world.z - viewer.z, spec.range));
  });
}
