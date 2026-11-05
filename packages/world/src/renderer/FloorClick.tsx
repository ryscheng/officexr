import { useEffect, useEffectEvent } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { Vec3 } from '@officexr/sdk';
import { feetPosition } from '../physics/rules.ts';
import { isClick } from './floorClick.ts';

interface FloorClickProps {
  playerPosRef: React.RefObject<THREE.Vector3>;
  charRadius: number;
  onFloorClick: (point: Vec3) => void;
}

/** Reports where a click lands on the horizontal plane through the local player's feet. */
export function FloorClick({ playerPosRef, charRadius, onFloorClick }: FloorClickProps) {
  const { gl, camera } = useThree();
  const report = useEffectEvent((e: PointerEvent) => {
    const pos = playerPosRef.current;
    if (!pos) {
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const feet = feetPosition(pos, charRadius);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -feet.y), new THREE.Vector3());
    if (hit) {
      onFloorClick({ x: hit.x, y: hit.y, z: hit.z });
    }
  });

  useEffect(() => {
    const canvas = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (down && isClick(down, { x: e.clientX, y: e.clientY })) {
        report(e);
      }
      down = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  return null;
}
