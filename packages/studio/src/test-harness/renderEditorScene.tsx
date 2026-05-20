import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { ApplicationProvider } from '@officexr/world/react';
import type { ApplicationApi } from '@officexr/world/app';
import { createTestApi } from './createTestApi.ts';

export type EditorSceneRenderer = Awaited<
  ReturnType<typeof ReactThreeTestRenderer.create>
>;

/**
 * Mount an R3F scene subtree (e.g. the Map editor's `<RoomsLayer>`)
 * under a hermetic `<ApplicationProvider>` using
 * `@react-three/test-renderer`.
 *
 * The test renderer reconciles into a real three.js scene graph (no
 * DOM, no WebGL), so it can host the editor's *canvas contents* — but
 * NOT the editor App itself, which is wrapped in DOM chrome + a
 * `<Canvas>`. Scenarios therefore mount the exported scene layers
 * directly and assert on the resulting callbacks / scene graph.
 *
 * The catalog used by the scene resolves from `createTestApi` (bundled
 * default, no network). Call `await renderer.advanceFrames?.()` or just
 * `await new Promise(r => setTimeout(r))` in the test if you need the
 * catalog-ready effect to settle before querying meshes.
 */
export async function renderEditorScene(
  node: React.ReactNode,
  opts: { api?: ApplicationApi } = {},
): Promise<EditorSceneRenderer> {
  const api = opts.api ?? createTestApi();
  return ReactThreeTestRenderer.create(
    <ApplicationProvider api={api}>{node}</ApplicationProvider>,
  );
}
