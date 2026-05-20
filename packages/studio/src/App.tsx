import React, { useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider } from '@officexr/world/react';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  type LayoutDocument,
  type MapDocumentV1,
  type RoomDocument,
} from '@officexr/world/scenes';
import { StudioPage } from './StudioPage.tsx';
import { HeadlessApp } from './modes/headless/HeadlessApp.tsx';
import { createTestApi } from './test-harness/createTestApi.ts';
import {
  TestStorageProvider,
  type TestStorages,
} from './test-harness/TestStorageContext.tsx';

/**
 * Shape of `window.__OFFICEXR_TEST_SEED__`, set by a Playwright spec via
 * `page.addInitScript(...)` before the app boots. Each array seeds the
 * matching in-memory storage so an editor opens with known content.
 */
interface TestSeed {
  maps?: Array<{ name: string; doc: MapDocumentV1 }>;
  rooms?: Array<{ name: string; doc: RoomDocument }>;
  layouts?: Array<{ name: string; doc: LayoutDocument }>;
}

/** Build the hermetic in-memory storages for `?test=1` mode, seeding
 *  them from `window.__OFFICEXR_TEST_SEED__` if present. */
function buildTestStorages(): TestStorages {
  const seed = (globalThis as { __OFFICEXR_TEST_SEED__?: TestSeed })
    .__OFFICEXR_TEST_SEED__;
  return {
    mapStorage: new InMemoryMapStorage({ seed: seed?.maps }),
    roomStorage: new InMemoryRoomStorage({ seed: seed?.rooms }),
    layoutStorage: new InMemoryLayoutStorage({ seed: seed?.layouts }),
  };
}

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
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const op = params.get('op');
  const sceneId = params.get('scene') ?? undefined;
  // `?test=1` boots the studio hermetically: a bundled-catalog api (no
  // /api/world-object-kinds fetch) + in-memory storages (no /api/maps
  // etc.). Used by the Playwright suite so editor interaction can be
  // exercised without a backend. Documented in CLAUDE.md.
  const testMode = params.get('test') === '1';

  const api = useMemo(() => {
    if (testMode) return createTestApi();
    const loader = new GLTFLoader();
    return createDefaultApi({
      loadGltf: async (path) => {
        const gltf = await loader.loadAsync(path);
        return { scene: gltf.scene as THREE.Object3D };
      },
    });
  }, [testMode]);

  const testStorages = useMemo<TestStorages | null>(
    () => (testMode ? buildTestStorages() : null),
    [testMode],
  );

  const tree = op ? <HeadlessApp op={op} sceneId={sceneId} /> : <StudioPage />;

  return (
    <ApplicationProvider api={api}>
      {testStorages ? (
        <TestStorageProvider value={testStorages}>{tree}</TestStorageProvider>
      ) : (
        tree
      )}
    </ApplicationProvider>
  );
}
