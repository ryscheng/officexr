import React, { type ReactNode } from 'react';
import type * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Adventurer } from './Adventurer.tsx';
import { EndlessGrid } from './EndlessGrid.tsx';
import { DEFAULT_EDITOR_LIGHTING, LightingRig } from './LightingRig.tsx';

const CHARACTER_PREVIEW_LIGHTING = {
  ...DEFAULT_EDITOR_LIGHTING,
  sunPosition: [10, 20, 10] as [number, number, number],
  sunIntensity: 1.2,
  ambientFillIntensity: 0.7,
};

type CharacterPreviewCanvasProps = Omit<React.ComponentProps<typeof Adventurer>, 'ref' | 'motion'> & {
  motion?: React.ComponentProps<typeof Adventurer>['motion'];
  /** The character's wrapping group, for callers that move or turn it. */
  groupRef?: React.Ref<THREE.Group>;
  /** Extra scene content, e.g. camera or input controllers. */
  children?: ReactNode;
};

/** A canvas showing one character, facing the camera, on an endless grid. */
export function CharacterPreviewCanvas({ groupRef, children, motion = 'idle', ...adventurer }: CharacterPreviewCanvasProps) {
  return (
    <Canvas
      camera={{ position: [0, 3.2, 4.5], fov: 45, near: 0.1, far: 200 }}
      onCreated={({ camera }) => camera.lookAt(0, 1, 0)}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <LightingRig lighting={CHARACTER_PREVIEW_LIGHTING} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <group ref={groupRef}>
        {/* Remount on a model change so the animation mixer binds to the new model's bones. */}
        <Adventurer key={adventurer.character} motion={motion} {...adventurer} />
      </group>
      {children}
    </Canvas>
  );
}
