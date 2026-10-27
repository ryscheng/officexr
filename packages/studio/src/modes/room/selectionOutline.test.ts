import { describe, it, expect } from 'vitest';
import {
  outlineEdgePositions,
  type WorldAABB,
} from './selectionOutline.ts';

function edgeCount(positions: Float32Array): number {
  return positions.length / 6;
}

/** Make an axis-aligned AABB from min + size in world meters. */
function box(
  min: [number, number, number],
  size: [number, number, number] = [1, 1, 1],
): WorldAABB {
  return {
    min,
    max: [min[0] + size[0], min[1] + size[1], min[2] + size[2]],
  };
}

describe('outlineEdgePositions', () => {
  it('returns no edges for an empty selection', () => {
    expect(edgeCount(outlineEdgePositions([]))).toBe(0);
  });

  it('outlines a single isolated cube with exactly 12 edges', () => {
    expect(edgeCount(outlineEdgePositions([box([0, 0, 0])]))).toBe(12);
  });

  it('outlines two stacked cubes with 20 unique edges', () => {
    // Two cubes sharing one horizontal face. The 4 edges around the
    // shared face's perimeter dedupe to 1 emission per edge; the rest
    // of each cube's 12 edges stay. 12 + 12 - 4 = 20.
    const out = outlineEdgePositions([box([0, 0, 0]), box([0, 1, 0])]);
    expect(edgeCount(out)).toBe(20);
  });

  it('outlines two disjoint cubes as two separate 12-edge boxes', () => {
    const out = outlineEdgePositions([box([0, 0, 0]), box([10, 0, 0])]);
    expect(edgeCount(out)).toBe(24);
  });

  it('L-shape: 3 cubes with 2 shared faces → 28 edges', () => {
    const lShape = [box([0, 0, 0]), box([1, 0, 0]), box([0, 0, 1])];
    const count = edgeCount(outlineEdgePositions(lShape));
    expect(count).toBe(28);
  });

  it('2×2×1 slab: 4 cubes form a 3×3 grid silhouette → 33 edges', () => {
    const slab = [
      box([0, 0, 0]),
      box([1, 0, 0]),
      box([0, 0, 1]),
      box([1, 0, 1]),
    ];
    const count = edgeCount(outlineEdgePositions(slab));
    expect(count).toBe(33);
  });

  it('a 2 m AABB outlines as a 2 m wireframe', () => {
    // The whole motivation for the refactor: a 2 m cube whose AABB
    // is (-1, 0, -1) → (1, 2, 1) should produce a 2 m wireframe.
    const out = outlineEdgePositions([
      { min: [-1, 0, -1], max: [1, 2, 1] },
    ]);
    const maxCoord = Math.max(...Array.from(out));
    expect(maxCoord).toBe(2);
    expect(edgeCount(out)).toBe(12);
  });

  it('two adjacent 2 m cubes outline as a single combined silhouette', () => {
    // Cube A AABB [(-1,0,-1),(1,2,1)]. Cube B AABB [(1,0,-1),(3,2,1)].
    // They share the face at x=1. The 4 edges of that shared face
    // dedupe. Combined: 12 + 12 - 4 = 20.
    const out = outlineEdgePositions([
      { min: [-1, 0, -1], max: [1, 2, 1] },
      { min: [1, 0, -1], max: [3, 2, 1] },
    ]);
    expect(edgeCount(out)).toBe(20);
    const maxX = Math.max(...Array.from(out).filter((_, i) => i % 3 === 0));
    expect(maxX).toBe(3);
  });

  it('ring (3×3 with hole) outlines with more edges than the AABB would suggest', () => {
    const ring = [
      box([0, 0, 0]), box([1, 0, 0]), box([2, 0, 0]),
      box([0, 0, 1]),                  box([2, 0, 1]),
      box([0, 0, 2]), box([1, 0, 2]), box([2, 0, 2]),
    ];
    const count = edgeCount(outlineEdgePositions(ring));
    expect(count).toBeGreaterThan(20);
  });
});
