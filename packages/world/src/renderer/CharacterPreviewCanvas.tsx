import React, { type ReactNode } from 'react';
import type * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Adventurer, ANIMATION_URLS } from './Adventurer.tsx';
import { EndlessGrid } from './EndlessGrid.tsx';
import { DEFAULT_EDITOR_LIGHTING, LightingRig } from './LightingRig.tsx';
import { logModelError } from './ModelWithFallback.tsx';
import { ResetKeyErrorBoundary } from './ResetKeyErrorBoundary.tsx';
import { SwapWhenLoaded } from './SwapWhenLoaded.tsx';

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

const sameUrl = (url: string) => url;
const modelUrls = (url: string) => [url, ...ANIMATION_URLS];

/** A canvas showing one character, facing the camera, on an endless grid. */
export function CharacterPreviewCanvas({ url, groupRef, children, motion = 'idle', ...adventurer }: CharacterPreviewCanvasProps) {
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
        {/* R3F's <Canvas> rethrows a suspension or error from inside it into the host tree, where
            the nearest boundary can be the one around the whole world view. Both stop here, and
            the previous model stays up while the next one downloads. */}
        <SwapWhenLoaded
          value={url}
          keyOf={sameUrl}
          urlsOf={modelUrls}
          render={(shown) => (
            <ResetKeyErrorBoundary resetKey={shown} onError={logModelError(shown)}>
              {/* Remount on a model change so the animation mixer binds to the new model's bones. */}
              <Adventurer key={shown} url={shown} motion={motion} {...adventurer} />
            </ResetKeyErrorBoundary>
          )}
        />
      </group>
      {children}
    </Canvas>
  );
}
