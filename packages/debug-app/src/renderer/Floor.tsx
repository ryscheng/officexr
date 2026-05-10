import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { CUBE_SIZE, WORLD } from './config.ts';

const BLUE_URL = '/models/blocks/colored_block_blue.gltf';
const STONE_URL = '/models/blocks/stone.gltf';

useGLTF.preload(BLUE_URL);
useGLTF.preload(STONE_URL);

interface FloorProps {
  gridSize?: number;
  stoneLayers?: number;
}

/**
 * Renders the world floor as instanced GLTF cubes:
 *   - top surface: blue colored_block
 *   - below: `stoneLayers` layers of stone cubes
 *
 * Centered on the world origin. Each cube occupies a CUBE_SIZE-meter cell.
 */
export function Floor({
  gridSize = WORLD.gridSize,
  stoneLayers = WORLD.stoneLayers,
}: FloorProps) {
  const blue = useGLTF(BLUE_URL);
  const stone = useGLTF(STONE_URL);

  const blueGeom = useMemo(() => extractGeometry(blue.scene), [blue.scene]);
  const blueMat = useMemo(() => extractMaterial(blue.scene), [blue.scene]);
  const stoneGeom = useMemo(() => extractGeometry(stone.scene), [stone.scene]);
  const stoneMat = useMemo(() => extractMaterial(stone.scene), [stone.scene]);

  const surfaceCount = gridSize * gridSize;
  const stoneCount = surfaceCount * stoneLayers;

  const surfaceRef = useRef<THREE.InstancedMesh>(null);
  const stoneRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!surfaceRef.current) return;
    fillGrid(surfaceRef.current, gridSize, [-CUBE_SIZE / 2]);
  }, [gridSize]);

  useEffect(() => {
    if (!stoneRef.current) return;
    const ys: number[] = [];
    for (let layer = 1; layer <= stoneLayers; layer++) {
      ys.push(-CUBE_SIZE / 2 - layer * CUBE_SIZE);
    }
    fillGrid(stoneRef.current, gridSize, ys);
  }, [gridSize, stoneLayers]);

  return (
    <>
      <instancedMesh
        ref={surfaceRef}
        args={[blueGeom, blueMat, surfaceCount]}
        receiveShadow
      />
      <instancedMesh
        ref={stoneRef}
        args={[stoneGeom, stoneMat, stoneCount]}
        receiveShadow
      />
    </>
  );
}

function extractGeometry(scene: THREE.Object3D): THREE.BufferGeometry {
  let geom: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!geom && (o as THREE.Mesh).isMesh) geom = (o as THREE.Mesh).geometry;
  });
  if (!geom) throw new Error('No mesh geometry found in GLTF scene');
  return geom;
}

function extractMaterial(scene: THREE.Object3D): THREE.Material {
  let mat: THREE.Material | null = null;
  scene.traverse((o) => {
    if (!mat && (o as THREE.Mesh).isMesh)
      mat = (o as THREE.Mesh).material as THREE.Material;
  });
  if (!mat) throw new Error('No mesh material found in GLTF scene');
  return mat;
}

/**
 * Fill an InstancedMesh with a square grid of `gridSize × gridSize` cubes,
 * repeated at each y in `ys`. Centered on origin.
 */
function fillGrid(
  inst: THREE.InstancedMesh,
  gridSize: number,
  ys: number[],
): void {
  const m = new THREE.Matrix4();
  const half = (gridSize - 1) / 2;
  let idx = 0;
  for (const y of ys) {
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = (i - half) * CUBE_SIZE;
        const z = (j - half) * CUBE_SIZE;
        m.makeTranslation(x, y, z);
        inst.setMatrixAt(idx++, m);
      }
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.count = idx;
  inst.computeBoundingSphere();
}
