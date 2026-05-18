import React, { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldObjects } from '@officexr/sdk';
import { createStore, createActions } from '@officexr/sdk';
import { LightingRig, ObjectInstances } from '@officexr/world/renderer';
import { useApplication, useCatalogReady } from '@officexr/world/react';

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
  const catalogReady = useCatalogReady();
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

  const [framePainted, setFramePainted] = useState(false);
  useEffect(() => {
    if (!catalogReady) return;
    // Two RAFs to ensure the first useEffect after mount has flushed
    // and a frame has been painted by Three's render loop.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setFramePainted(true);
        const w = window as unknown as { __officexrBoundsReady?: boolean };
        w.__officexrBoundsReady = true;
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [catalogReady]);

  return (
    <div
      data-bounds-scene={sceneId}
      data-bounds-ready={framePainted ? 'true' : 'false'}
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
        <ObjectInstances store={store} />
      </Canvas>
    </div>
  );
}
