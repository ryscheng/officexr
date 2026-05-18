import React, { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldObjects } from '@officexr/sdk';
import { createStore, createActions } from '@officexr/sdk';
import { LightingRig, ObjectInstances } from '@officexr/world/renderer';
import { useApplication } from '@officexr/world/react';

interface BoundsSceneProps {
  sceneId: string;
}

/**
 * Deterministic visual-regression scene.
 *
 * Mounted by HeadlessApp on `?op=bounds-scene&scene=<id>`. Looks up
 * the named scene via the application layer's SceneService, builds a
 * lightweight headless SDK store seeded with its instances, and
 * renders them through the same `<ObjectInstances>` the studio uses.
 *
 * Camera + lighting are fixed so the resulting canvas is
 * frame-deterministic — Playwright + pixelmatch can diff it against a
 * checked-in baseline PNG.
 *
 * `window.__officexrBoundsReady` flips to `true` once the scene's
 * GLTFs have loaded and the first frame has been painted, so the
 * driver knows when to capture pixels.
 */
export function BoundsScene({ sceneId }: BoundsSceneProps) {
  const api = useApplication();
  const scene = useMemo(() => api.scenes.load(sceneId), [api, sceneId]);

  const worldObjects: WorldObjects = useMemo(
    () => ({
      cubeSize: api.voxelSize,
      instances: [...scene.instances],
    }),
    [api, scene.instances],
  );

  // Local SDK store so <ObjectInstances> can subscribe via the same
  // contract it expects in production.
  const store = useMemo(() => {
    const s = createStore({ selfId: 'headless', officeId: 'bounds-scene' });
    const actions = createActions(s);
    actions.setWorldObjects(worldObjects);
    return s;
  }, [worldObjects]);

  // Compute orbit camera position from the scene's CameraPose.
  const cameraPos = useMemo(() => {
    const { target, azimuth, elevation, distance } = scene.camera;
    const cos = Math.cos(elevation);
    return [
      target[0] + distance * cos * Math.sin(azimuth),
      target[1] + distance * Math.sin(elevation),
      target[2] + distance * cos * Math.cos(azimuth),
    ] as [number, number, number];
  }, [scene.camera]);

  useEffect(() => {
    return () => {
      // Reset the sentinel so the next mount starts clean.
      delete (window as unknown as { __officexrBoundsReady?: boolean })
        .__officexrBoundsReady;
    };
  }, []);

  return (
    <div
      data-bounds-scene={sceneId}
      style={{ position: 'absolute', inset: 0, background: '#202024' }}
    >
      <Canvas
        camera={{
          position: cameraPos,
          fov: 45,
          near: 0.1,
          far: 200,
        }}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ camera }) => {
          camera.lookAt(new THREE.Vector3(...scene.camera.target));
        }}
      >
        <LightingRig
          lighting={{
            sunPosition: [5, 10, 5],
            sunColor: '#ffffff',
            sunIntensity: 1,
            ambientIntensity: 0.4,
            castShadow: true,
            shadowRange: 30,
            shadowMapSize: 1024,
            shadowBias: -0.0005,
            shadowNormalBias: 0.02,
            auxLightType: 'none',
            auxIntensity: 0,
            auxDistance: 0,
            auxAngle: 0,
            auxPenumbra: 0,
            auxDecay: 1,
            showSunDisc: false,
            sunDiscRadius: 0,
            sunDiscIntensity: 0,
          }}
        />
        <Suspense fallback={null}>
          <ObjectInstances store={store} />
          {/* Sits AFTER the Suspense boundary so it only mounts once
              the GLTFs have loaded. Counts rendered frames and flips
              the global ready sentinel after a safe number of frames
              (enough for InstancedMesh.setMatrixAt to have run AND
              the GL framebuffer to have settled). */}
          <ReadySignal />
        </Suspense>
      </Canvas>
    </div>
  );
}

/**
 * Frame counter that flips `window.__officexrBoundsReady` after a few
 * rendered frames. Mounts only after the parent's Suspense boundary
 * resolves, so GLTFs are guaranteed to be loaded by the time the
 * sentinel is set.
 */
function ReadySignal() {
  const framesRef = React.useRef(0);
  const flippedRef = React.useRef(false);
  // 3 frames is enough for InstancedMesh.setMatrixAt to have run
  // (one frame for mount, one for the matrix update effect, one for
  // the next paint pass).
  const FRAMES_BEFORE_READY = 3;
  useFrame(() => {
    if (flippedRef.current) return;
    framesRef.current += 1;
    if (framesRef.current >= FRAMES_BEFORE_READY) {
      flippedRef.current = true;
      (window as unknown as { __officexrBoundsReady?: boolean })
        .__officexrBoundsReady = true;
    }
  });
  return null;
}
