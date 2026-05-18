import React, { useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider } from '@officexr/world/react';
import { StudioPage } from './StudioPage.tsx';
import { HeadlessApp } from './modes/headless/HeadlessApp.tsx';

/**
 * Studio root.
 *
 * Wires the `ApplicationApi` once at the top of the tree and hands it
 * to every mode via React context (`<ApplicationProvider>`). All
 * downstream components — Room editor, Map editor, Object editor,
 * renderer primitives — read from `useApplication()` (or the derived
 * hooks `useCatalog`, `useKind`, `useInstanceAABB`) rather than from
 * module-level singletons.
 *
 * SOLID note (DIP): the only place that knows about concrete service
 * implementations is `createDefaultApi`. Tests / headless harnesses
 * can swap in mocks at this layer without touching the consumers.
 *
 * The `loadGltf` we inject here uses three's GLTFLoader — same code
 * path drei's `useGLTF` already relies on internally, so opening a
 * kind in the Object editor and then asking the BakeService to
 * measure it do not double-download the GLTF (browsers cache the
 * HTTP response).
 */
export default function App() {
  const api = useMemo(() => {
    const loader = new GLTFLoader();
    return createDefaultApi({
      loadGltf: async (path) => {
        const gltf = await loader.loadAsync(path);
        return { scene: gltf.scene as THREE.Object3D };
      },
    });
  }, []);

  // `?op=...` URL param routes to the headless test harness instead
  // of the studio UI. The application api is the same — both layers
  // consume the same DI-managed services.
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const op = params.get('op');
  const sceneId = params.get('scene') ?? undefined;

  return (
    <ApplicationProvider api={api}>
      {op ? <HeadlessApp op={op} sceneId={sceneId} /> : <StudioPage />}
    </ApplicationProvider>
  );
}
