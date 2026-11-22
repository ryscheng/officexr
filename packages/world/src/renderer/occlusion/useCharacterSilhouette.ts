import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useOccluderRegistry } from './OccluderContext.tsx';
import { createCharacterSilhouette, type CharacterSilhouette } from './characterSilhouette.ts';

export interface SilhouetteSpec {
  playerId?: string;
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
  const registry = useOccluderRegistry();
  const handle = useRef<CharacterSilhouette | null>(null);
  const shown = useRef(true);
  const frame = useRef(0);
  const enabled = spec?.enabled ?? false;
  const color = spec?.color ?? '#ffffff';
  const gated = spec?.viewerRef !== undefined;

  useEffect(() => {
    if (!enabled) return;
    const silhouette = createCharacterSilhouette(scene, color);
    handle.current = silhouette;
    shown.current = !gated;
    silhouette.setVisible(!gated);
    return () => {
      silhouette.dispose();
      handle.current = null;
    };
  }, [scene, enabled, gated, color]);

  useFrame(() => {
    const silhouette = handle.current;
    if (!silhouette || !spec) return;
    if (frame.current++ % CHECK_EVERY_FRAMES !== 0) return;
    let visible = !(spec.playerId !== undefined && registry?.silhouetteSuppressed(spec.playerId));
    const viewer = spec.viewerRef?.current;
    if (viewer && spec.range !== undefined) {
      scene.getWorldPosition(world);
      visible = visible && withinRange(world.x - viewer.x, world.z - viewer.z, spec.range);
    } else if (gated) {
      return;
    }
    if (visible === shown.current) return;
    shown.current = visible;
    silhouette.setVisible(visible);
  });
}
