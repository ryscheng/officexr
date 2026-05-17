import { describe, it, expect } from 'vitest';
import { outlineEdgePositions, type Vec3 } from './selectionOutline.ts';

function edgeCount(positions: Float32Array): number {
  return positions.length / 6;
}

const UNIT = { width: 1, height: 1, depth: 1 };

/** Helper: wrap a voxel position into the new OutlineBox shape with
 * 1×1×1 dims so these tests can mirror the legacy assertions on
 * adjacency / dedup counts. */
function box(position: Vec3, dims = UNIT) {
  return { position, dims };
}

describe('outlineEdgePositions', () => {
  it('returns no edges for an empty selection', () => {
    expect(edgeCount(outlineEdgePositions([], 1))).toBe(0);
  });

  it('outlines a single isolated cube with exactly 12 edges', () => {
    expect(edgeCount(outlineEdgePositions([box([0, 0, 0])], 1))).toBe(12);
  });

  it('outlines two stacked cubes with 20 unique edges', () => {
    // Two cubes sharing one horizontal face. The 4 edges around the
    // shared face's perimeter dedupe to 1 emission per edge; the rest
    // of each cube's 12 edges stay. 12 + 12 - 4 = 20.
    const out = outlineEdgePositions(
      [box([0, 0, 0]), box([0, 1, 0])],
      1,
    );
    expect(edgeCount(out)).toBe(20);
  });

  it('outlines two disjoint cubes as two separate 12-edge boxes', () => {
    const out = outlineEdgePositions(
      [box([0, 0, 0]), box([10, 0, 0])],
      1,
    );
    expect(edgeCount(out)).toBe(24);
  });

  it('L-shape: 3 cubes with 2 shared faces → 28 edges', () => {
    const lShape = [box([0, 0, 0]), box([1, 0, 0]), box([0, 0, 1])];
    const count = edgeCount(outlineEdgePositions(lShape, 1));
    expect(count).toBe(28);
  });

  it('2×2×1 slab: 4 cubes form a 3×3 grid silhouette → 33 edges', () => {
    // The dedup output for a 2×2 plane of 1m cubes:
    //   - 9 vertical edges (one per grid intersection in xz)
    //   - 12 bottom edges (3 horizontal × 2 segments + 3 vertical × 2)
    //   - 12 top edges (same as bottom)
    //   = 33.
    const slab = [
      box([0, 0, 0]),
      box([1, 0, 0]),
      box([0, 0, 1]),
      box([1, 0, 1]),
    ];
    const count = edgeCount(outlineEdgePositions(slab, 1));
    expect(count).toBe(33);
  });

  it('a 2 m cube on the 0.5 m grid outlines as a 2 m AABB', () => {
    // The whole motivation for the refactor: a 2 m cube at voxel
    // (0,0,0) on a 0.5 m grid should produce a 2 m wireframe (max
    // coord = 2 m), not a 0.5 m sub-cell.
    const out = outlineEdgePositions(
      [box([0, 0, 0], { width: 2, height: 2, depth: 2 })],
      0.5,
    );
    const maxCoord = Math.max(...Array.from(out));
    expect(maxCoord).toBe(2);
    expect(edgeCount(out)).toBe(12);
  });

  it('two adjacent 2 m cubes (on 0.5 m grid) outline as a single combined silhouette', () => {
    // Cube A at voxel 0 → world AABB [0, 2]. Cube B at voxel 4 →
    // world AABB [2, 4]. They share the face at x=2. The 4 edges
    // of that shared face dedupe. Combined: 12 + 12 - 4 = 20.
    const out = outlineEdgePositions(
      [
        box([0, 0, 0], { width: 2, height: 2, depth: 2 }),
        box([4, 0, 0], { width: 2, height: 2, depth: 2 }),
      ],
      0.5,
    );
    expect(edgeCount(out)).toBe(20);
    const maxX = Math.max(...Array.from(out).filter((_, i) => i % 3 === 0));
    expect(maxX).toBe(4);
  });

  it('coords scale by voxelSize when the position is non-zero', () => {
    // Same dims, different voxelSize. Cube at voxel (1,0,0) → world
    // anchor x = voxelSize. Bigger voxelSize → bigger max coord.
    const a = outlineEdgePositions([box([1, 0, 0])], 1);
    const b = outlineEdgePositions([box([1, 0, 0])], 2);
    const maxA = Math.max(...Array.from(a).map(Math.abs));
    const maxB = Math.max(...Array.from(b).map(Math.abs));
    expect(maxB).toBeGreaterThan(maxA);
  });

  it('ring (3×3 with hole) outlines with more edges than the AABB would suggest', () => {
    const ring = [
      box([0, 0, 0]), box([1, 0, 0]), box([2, 0, 0]),
      box([0, 0, 1]),                  box([2, 0, 1]),
      box([0, 0, 2]), box([1, 0, 2]), box([2, 0, 2]),
    ];
    const count = edgeCount(outlineEdgePositions(ring, 1));
    expect(count).toBeGreaterThan(20);
  });
});
