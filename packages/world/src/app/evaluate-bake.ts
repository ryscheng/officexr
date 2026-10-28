/**
 * Compares a stored baked layout GLB with the layout it was baked from.
 *
 * Headless: no `three`, no `react`, no DOM — safe for studio-mcp to import.
 */

import { WebIO } from '@gltf-transform/core';
import type { LayoutDocument } from '../scenes/layout-document.ts';
import { resolveOptimizer } from './bake-optimizers.ts';
import { BAKE_SOURCE_VERSION, computeBakeSourceFingerprint } from './bake-source.ts';
import { parseBakeSource } from './baked-collider-extras.ts';
import type { KindLookup } from './layout-bake-service.ts';

export { BAKE_SOURCE_VERSION, computeBakeSourceFingerprint };

/** `unknown`: no provenance to compare, or none computable now. */
export type BakeStatus =
  | { type: 'missing' }
  | { type: 'unknown' }
  | { type: 'stale' }
  | { type: 'fresh' };

export type BakeStatusType = BakeStatus['type'];

/** Throws when `glb` is not a readable GLB. */
export async function evaluateBake(
  layout: LayoutDocument,
  glb: Uint8Array | null,
  kindLookup: KindLookup,
): Promise<BakeStatus> {
  if (glb === null) {
    return { type: 'missing' };
  }
  const root = (await new WebIO().readBinary(glb)).getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const stored = scene ? parseBakeSource(scene.getExtras()) : null;
  if (!stored) {
    return { type: 'unknown' };
  }
  if (stored.version !== BAKE_SOURCE_VERSION) {
    return { type: 'stale' };
  }
  // Same resolution `bakeLayout` applies before hashing the optimizer id.
  const current = await computeBakeSourceFingerprint(layout, resolveOptimizer(layout.optimizer).id, kindLookup);
  if (current === null) {
    return { type: 'unknown' };
  }
  return { type: current === stored.fingerprint ? 'fresh' : 'stale' };
}
