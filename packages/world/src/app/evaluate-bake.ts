/**
 * Compares a stored baked layout GLB with the layout it was baked from.
 *
 * Headless: no `three`, no `react`, no DOM — safe for studio-mcp to import.
 */

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

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/**
 * Reads only the GLB's JSON chunk: baked GLBs are meshopt-compressed, and decoding them
 * needs codecs this headless module doesn't load.
 */
function readGlbJson(glb: Uint8Array): { scene?: number; scenes?: Array<{ extras?: unknown }> } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.length < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error('not a GLB: missing header or JSON chunk');
  }
  const end = 20 + view.getUint32(12, true);
  if (end > glb.length) {
    throw new Error('not a GLB: JSON chunk is truncated');
  }
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, end)));
}

/** Throws when `glb` is not a GLB. */
export async function evaluateBake(
  layout: LayoutDocument,
  glb: Uint8Array | null,
  kindLookup: KindLookup,
): Promise<BakeStatus> {
  if (glb === null) {
    return { type: 'missing' };
  }
  const json = readGlbJson(glb);
  const stored = parseBakeSource(json.scenes?.[json.scene ?? 0]?.extras);
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
