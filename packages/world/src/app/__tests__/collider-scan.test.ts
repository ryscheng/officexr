/**
 * Unit tests for the collider scanner. Geometry is synthesized with
 * gltf-transform directly (same hermetic pattern as
 * layout-bake-service.test.ts) — no filesystem, no real GLBs.
 */
import { describe, it, expect } from 'vitest';
import { Document, type Scene } from '@gltf-transform/core';
import {
  extractLocalTriangles,
  scanColliderCuboids,
  type NormalizedCuboid,
} from '../collider-scan.ts';

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/** Append a solid axis-aligned box (12 triangles) as one mesh node. */
function addBox(
  doc: Document,
  scene: Scene,
  min: [number, number, number],
  max: [number, number, number],
  name = 'box',
): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // 8 corners.
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // 12 triangles (two per face).
  const idx = [
    0, 1, 2, 0, 2, 3, // back  (z0)
    4, 6, 5, 4, 7, 6, // front (z1)
    0, 4, 5, 0, 5, 1, // bottom
    3, 2, 6, 3, 6, 7, // top
    0, 3, 7, 0, 7, 4, // left
    1, 5, 6, 1, 6, 2, // right
  ];
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(v.flat()))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array(idx))
    .setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', pos)
    .setIndices(indices);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

function topOf(c: NormalizedCuboid): number {
  return c.max[1];
}

// ---------------------------------------------------------------------------
// extractLocalTriangles
// ---------------------------------------------------------------------------

describe('extractLocalTriangles', () => {
  it('applies node transforms (translation + scale)', () => {
    const doc = new Document();
    const scene = doc.createScene('s');
    const buffer = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos);
    const mesh = doc.createMesh('m').addPrimitive(prim);
    const node = doc
      .createNode('n')
      .setMesh(mesh)
      .setTranslation([10, 20, 30])
      .setScale([2, 2, 2]);
    scene.addChild(node);

    const { positions, indices } = extractLocalTriangles(doc);
    expect(indices.length).toBe(3);
    // Vertex (1,0,0) → scaled (2,0,0) → translated (12,20,30).
    expect(Array.from(positions.slice(3, 6))).toEqual([12, 20, 30]);
  });

  it('handles non-indexed primitives (sequential triangles)', () => {
    const doc = new Document();
    const scene = doc.createScene('s');
    const buffer = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos);
    scene.addChild(
      doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)),
    );
    const { indices } = extractLocalTriangles(doc);
    expect(Array.from(indices)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// scanColliderCuboids
// ---------------------------------------------------------------------------

describe('scanColliderCuboids', () => {
  it('reduces a solid box to a single full-AABB cuboid', () => {
    const doc = new Document();
    const scene = doc.createScene('s');
    addBox(doc, scene, [0, 0, 0], [2, 1, 2]);

    const result = scanColliderCuboids(doc, { cellSize: 0.25 });
    expect(result.aabb).toEqual({ min: [0, 0, 0], max: [2, 1, 2] });
    expect(result.cuboids.length).toBe(1);
    const c = result.cuboids[0];
    expect(c.min).toEqual([0, 0, 0]);
    expect(c.max[0]).toBeCloseTo(1, 6);
    expect(c.max[1]).toBeCloseTo(1, 6);
    expect(c.max[2]).toBeCloseTo(1, 6);
  });

  it('recovers per-step columns from a 4-step staircase mesh', () => {
    // Steps descend toward +X like the KayKit stairs: step k spans
    // x ∈ [1−(k+1)·0.25, 1−k·0.25], height (k+1)·0.25, full Z depth.
    const doc = new Document();
    const scene = doc.createScene('s');
    for (let k = 0; k < 4; k++) {
      addBox(
        doc,
        scene,
        [1 - (k + 1) * 0.25, 0, 0],
        [1 - k * 0.25, (k + 1) * 0.25, 1],
        `step${k}`,
      );
    }

    const result = scanColliderCuboids(doc, { cellSize: 0.125 });
    expect(result.cuboids.length).toBe(4);

    // Sort by x and check ascending tops toward −X (descending x).
    const sorted = [...result.cuboids].sort((a, b) => a.min[0] - b.min[0]);
    const tops = sorted.map(topOf);
    // Heights normalized to AABB height 1.0: 1.0, 0.75, 0.5, 0.25.
    expect(tops[0]).toBeCloseTo(1.0, 5);
    expect(tops[1]).toBeCloseTo(0.75, 5);
    expect(tops[2]).toBeCloseTo(0.5, 5);
    expect(tops[3]).toBeCloseTo(0.25, 5);
    // Every column reaches the base and spans the full Z depth.
    for (const c of sorted) {
      expect(c.min[1]).toBe(0);
      expect(c.min[2]).toBeCloseTo(0, 5);
      expect(c.max[2]).toBeCloseTo(1, 5);
    }
  });

  it('produces monotonic stepped heights for a ramp surface', () => {
    // An inclined quad ascending toward +X from y=0 to y=1, plus a
    // base so the AABB has volume. (Heightfield output is a stepped
    // approximation — exactly why slopes use trimesh instead.)
    const doc = new Document();
    const scene = doc.createScene('s');
    const buffer = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(
        new Float32Array([
          0, 0, 0,  1, 1, 0,  1, 1, 1,
          0, 0, 0,  1, 1, 1,  0, 0, 1,
        ]),
      )
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos);
    scene.addChild(
      doc.createNode('ramp').setMesh(doc.createMesh('ramp').addPrimitive(prim)),
    );

    const result = scanColliderCuboids(doc, {
      cellSize: 0.25,
      heightEpsilon: 0.05,
    });
    expect(result.cuboids.length).toBeGreaterThan(1);
    // Group columns by x-range and compare each range's tallest top —
    // a ramp can legitimately split one x-range into several z-boxes,
    // but the height profile along +X must ascend.
    const byX = new Map<number, number>();
    for (const c of result.cuboids) {
      byX.set(c.min[0], Math.max(byX.get(c.min[0]) ?? 0, topOf(c)));
    }
    const xs = [...byX.keys()].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(byX.get(xs[i])!).toBeGreaterThan(byX.get(xs[i - 1])!);
    }
  });

  it('normalizes against a transformed mesh AABB', () => {
    const doc = new Document();
    const scene = doc.createScene('s');
    const buffer = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(
        // Unit box corners (reuse addBox topology inline via helper is
        // overkill — wrap the box in a transformed parent instead).
        new Float32Array([0, 0, 0]),
      )
      .setBuffer(buffer);
    void pos; // (only the boxed child below carries geometry)
    addBox(doc, scene, [0, 0, 0], [1, 1, 1], 'unit');
    // Re-parent the box node under a transformed wrapper.
    const boxNode = doc.getRoot().listNodes().find((n) => n.getName() === 'unit')!;
    const wrapper = doc
      .createNode('wrapper')
      .setTranslation([5, 5, 5])
      .setScale([2, 2, 2]);
    scene.removeChild(boxNode);
    wrapper.addChild(boxNode);
    scene.addChild(wrapper);

    const result = scanColliderCuboids(doc, { cellSize: 0.25 });
    expect(result.aabb.min).toEqual([5, 5, 5]);
    expect(result.aabb.max).toEqual([7, 7, 7]);
    expect(result.cuboids.length).toBe(1);
    expect(result.cuboids[0].max[1]).toBeCloseTo(1, 6);
  });

  it('throws when the cuboid cap is exceeded', () => {
    // A 16-step staircase at fine resolution → 16 columns > cap 8.
    const doc = new Document();
    const scene = doc.createScene('s');
    for (let k = 0; k < 16; k++) {
      addBox(
        doc,
        scene,
        [k * 0.25, 0, 0],
        [(k + 1) * 0.25, (k + 1) * 0.25, 1],
        `s${k}`,
      );
    }
    expect(() =>
      scanColliderCuboids(doc, { cellSize: 0.125, maxCuboids: 8 }),
    ).toThrow(/exceeds the cap/);
  });
});
