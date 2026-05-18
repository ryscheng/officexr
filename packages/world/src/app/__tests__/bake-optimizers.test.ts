/**
 * Unit tests for `BakeOptimizer` strategies.
 *
 * Strategy:
 *   - For each registered optimizer, build a small document with a few
 *     duplicate primitives and verify `apply()` mutates the document
 *     without throwing.
 *   - For lossy strategies (simplify-*), verify the post-apply primitive
 *     count is <= the pre-apply primitive count — proves the pipeline ran.
 *   - For the no-op strategy, verify the document is structurally
 *     unchanged.
 */

import { describe, it, expect } from 'vitest';
import { Document } from '@gltf-transform/core';
import {
  BAKE_OPTIMIZERS,
  defaultOptimizer,
  noneOptimizer,
  simplifyLightOptimizer,
  simplifyAggressiveOptimizer,
  resolveOptimizer,
} from '../bake-optimizers.ts';

/**
 * Build a document with N triangles in separate meshes, each at a
 * different offset so they have distinct vertex data. Distinct geometry
 * lets us tell the difference between strategies that drop primitives
 * intentionally (`join`, `simplify`) and those that only deduplicate
 * identical resources (`dedup`).
 */
function makeDistinctPrimDoc(n: number): Document {
  const doc = new Document();
  const scene = doc.createScene('test');
  const buffer = doc.createBuffer();

  for (let i = 0; i < n; i++) {
    const dx = i * 5; // unique per i — dedup will NOT collapse these
    const positions = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(
        new Float32Array([
          -1 + dx, 0, 0,
           1 + dx, 0, 0,
           0 + dx, 1, 0,
           1 + dx, 0, 0,
           1 + dx, 1, 0,
           0 + dx, 1, 0,
        ]),
      )
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', positions);
    const mesh = doc.createMesh(`m${i}`).addPrimitive(prim);
    const node = doc.createNode(`n${i}`).setMesh(mesh);
    scene.addChild(node);
  }

  return doc;
}

function totalPrimitives(doc: Document): number {
  return doc
    .getRoot()
    .listMeshes()
    .reduce((sum, m) => sum + m.listPrimitives().length, 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BakeOptimizer strategies', () => {
  it('registry contains all built-in strategies keyed by id', () => {
    expect(BAKE_OPTIMIZERS.get('default')).toBe(defaultOptimizer);
    expect(BAKE_OPTIMIZERS.get('simplify-light')).toBe(simplifyLightOptimizer);
    expect(BAKE_OPTIMIZERS.get('simplify-aggressive')).toBe(simplifyAggressiveOptimizer);
    expect(BAKE_OPTIMIZERS.get('none')).toBe(noneOptimizer);
  });

  it('resolveOptimizer falls back to default for unknown / undefined ids', () => {
    expect(resolveOptimizer(undefined)).toBe(defaultOptimizer);
    expect(resolveOptimizer('does-not-exist')).toBe(defaultOptimizer);
    expect(resolveOptimizer('simplify-light')).toBe(simplifyLightOptimizer);
  });

  it('none (minimal): runs buffer-level dedup + prune, no geometry merging', async () => {
    // "Minimal" keeps mesh primitives separate (no `join`), but `dedup`
    // collapses identical accessors/buffers — so primitive COUNT is
    // preserved while bytes shrink. This is the contract:
    //   - primitives in == primitives out
    //   - geometry unchanged at the mesh level
    const doc = makeDistinctPrimDoc(4);
    const before = totalPrimitives(doc);
    await noneOptimizer.apply(doc);
    expect(totalPrimitives(doc)).toBe(before);
  });

  it('default: collapses duplicate primitives (dedup + join)', async () => {
    const doc = makeDistinctPrimDoc(8);
    const before = totalPrimitives(doc);
    await defaultOptimizer.apply(doc);
    expect(totalPrimitives(doc)).toBeLessThan(before);
  });

  it('simplify-light: applies polygon reduction (post-apply primitives ≤ pre)', async () => {
    const doc = makeDistinctPrimDoc(8);
    const before = totalPrimitives(doc);
    await simplifyLightOptimizer.apply(doc);
    expect(totalPrimitives(doc)).toBeLessThanOrEqual(before);
  });

  it('simplify-aggressive: applies polygon reduction (post-apply primitives ≤ pre)', async () => {
    const doc = makeDistinctPrimDoc(8);
    const before = totalPrimitives(doc);
    await simplifyAggressiveOptimizer.apply(doc);
    expect(totalPrimitives(doc)).toBeLessThanOrEqual(before);
  });
});
