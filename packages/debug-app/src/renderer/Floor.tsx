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
    // Blue cube model is a clean 96-vertex box (bbox exactly ±1) with
    // shallow bevels — a small overlap is enough to bury the seams.
    fillGrid(surfaceRef.current, gridSize, [-CUBE_SIZE / 2], 1.1);
  }, [gridSize]);

  useEffect(() => {
    if (!stoneRef.current) return;
    const ys: number[] = [];
    for (let layer = 1; layer <= stoneLayers; layer++) {
      ys.push(-CUBE_SIZE / 2 - layer * CUBE_SIZE);
    }
    // Stone is a 1708-vertex rocky model — its surface has real
    // concavities that leave visible holes between neighbours at the
    // smaller blue scale. Push the overlap up so the rocky bumps from
    // each cube hide each other's gaps. Slightly Z-fighting tops in
    // the overlap region is invisible because both instances render
    // the same noisy material.
    fillGrid(stoneRef.current, gridSize, ys, 1.2);
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
 *
 * Each cube is scaled by `overlapScale` (≥ 1) so adjacent cubes overlap
 * slightly. KayKit BlockBits cubes have beveled / rocky corners — at
 * native size, two neighbouring cubes leave a small V-shaped groove
 * between their edges that catches the sun and reads as a grid line
 * on the floor (or, for rockier models like stone, lets the sky leak
 * through visible cracks). Scaling each instance up pushes the
 * outer geometry past its natural cell boundary so it buries the
 * neighbour's groove and the contiguous region reads as one cohesive
 * surface. The overlap region is small enough that any Z-fighting
 * between identical instances is invisible, and collision / other
 * code paths still see a `gridSize × CUBE_SIZE` footprint because
 * they don't read instance scale.
 *
 * Pass a larger `overlapScale` for noisier models (e.g. stone) and a
 * smaller one for clean-beveled models (e.g. the blue surface block).
 */
function fillGrid(
  inst: THREE.InstancedMesh,
  gridSize: number,
  ys: number[],
  overlapScale: number,
): void {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(overlapScale, overlapScale, overlapScale);
  const half = (gridSize - 1) / 2;
  let idx = 0;
  for (const y of ys) {
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = (i - half) * CUBE_SIZE;
        const z = (j - half) * CUBE_SIZE;
        pos.set(x, y, z);
        m.compose(pos, quat, scale);
        inst.setMatrixAt(idx++, m);
      }
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.count = idx;
  inst.computeBoundingSphere();
}
