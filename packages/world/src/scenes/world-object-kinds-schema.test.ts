/**
 * TDD tests for task-01: capability fields (tilingAxes, gravity, optimization)
 * on WorldObjectKind.
 *
 * These tests are written BEFORE the implementation (RED → GREEN workflow).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKind,
  validateWorldObjectKindCatalog,
} from './world-object-kinds-schema.ts';
import defaultCatalogJson from '../../world-object-kinds.default.json';

/** Minimal raw input for normalizeKind (only required fields). */
function minimalRaw(category = 'block', overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'test-kind',
    label: 'Test Kind',
    gltfPath: '/models/test.glb',
    swatch: '#ff0000',
    category,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeKind — tilingAxes
// ---------------------------------------------------------------------------

describe('normalizeKind — tilingAxes', () => {
  it('block category defaults all axes tileable', () => {
    const kind = normalizeKind(minimalRaw('block'), 0);
    expect(kind.tilingAxes).toEqual({ x: true, y: true, z: true });
  });

  it('furniture category defaults all axes non-tileable', () => {
    const kind = normalizeKind(minimalRaw('furniture'), 0);
    expect(kind.tilingAxes).toEqual({ x: false, y: false, z: false });
  });

  it('prototype category defaults all axes non-tileable', () => {
    const kind = normalizeKind(minimalRaw('prototype'), 0);
    expect(kind.tilingAxes).toEqual({ x: false, y: false, z: false });
  });

  it('restaurant category defaults all axes non-tileable', () => {
    const kind = normalizeKind(minimalRaw('restaurant'), 0);
    expect(kind.tilingAxes).toEqual({ x: false, y: false, z: false });
  });

  it('explicit tilingAxes preserved for furniture category', () => {
    const kind = normalizeKind(
      minimalRaw('furniture', { tilingAxes: { x: true, y: false, z: true } }),
      0,
    );
    expect(kind.tilingAxes).toEqual({ x: true, y: false, z: true });
  });

  it('explicit tilingAxes with non-boolean sub-fields falls back to category default', () => {
    // All sub-fields invalid → treat entire tilingAxes as absent
    const kind = normalizeKind(
      minimalRaw('block', { tilingAxes: { x: 'yes', y: 1, z: false } }),
      0,
    );
    expect(kind.tilingAxes).toEqual({ x: true, y: true, z: true });
  });
});

// ---------------------------------------------------------------------------
// normalizeKind — gravity
// ---------------------------------------------------------------------------

describe('normalizeKind — gravity', () => {
  it('defaults false when absent', () => {
    const kind = normalizeKind(minimalRaw(), 0);
    expect(kind.gravity).toBe(false);
  });

  it('explicit gravity: true preserved', () => {
    const kind = normalizeKind(minimalRaw('block', { gravity: true }), 0);
    expect(kind.gravity).toBe(true);
  });

  it('explicit gravity: false preserved', () => {
    const kind = normalizeKind(minimalRaw('block', { gravity: false }), 0);
    expect(kind.gravity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeKind — optimization
// ---------------------------------------------------------------------------

describe('normalizeKind — optimization', () => {
  it("defaults 'none' when absent", () => {
    const kind = normalizeKind(minimalRaw(), 0);
    expect(kind.optimization).toBe('none');
  });

  it("'static-batch' preserved", () => {
    const kind = normalizeKind(minimalRaw('block', { optimization: 'static-batch' }), 0);
    expect(kind.optimization).toBe('static-batch');
  });

  it("'frustum-cull' preserved", () => {
    const kind = normalizeKind(minimalRaw('block', { optimization: 'frustum-cull' }), 0);
    expect(kind.optimization).toBe('frustum-cull');
  });

  it("invalid optimization value falls back to 'none'", () => {
    const kind = normalizeKind(minimalRaw('block', { optimization: 'whatever' }), 0);
    expect(kind.optimization).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// normalizeKind — isLayoutObject
// ---------------------------------------------------------------------------

describe('normalizeKind — isLayoutObject', () => {
  it('defaults false when field is absent (backwards compat)', () => {
    const kind = normalizeKind(minimalRaw(), 0);
    expect(kind.isLayoutObject).toBe(false);
  });

  it('explicit isLayoutObject: true is preserved', () => {
    const kind = normalizeKind(minimalRaw('block', { isLayoutObject: true }), 0);
    expect(kind.isLayoutObject).toBe(true);
  });

  it('explicit isLayoutObject: false is preserved', () => {
    const kind = normalizeKind(minimalRaw('block', { isLayoutObject: false }), 0);
    expect(kind.isLayoutObject).toBe(false);
  });

  it('non-boolean isLayoutObject value falls back to false', () => {
    // Handles corrupted/old catalog entries gracefully
    const kind = normalizeKind(minimalRaw('block', { isLayoutObject: 1 }), 0);
    expect(kind.isLayoutObject).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateWorldObjectKindCatalog round-trip
// ---------------------------------------------------------------------------

describe('validateWorldObjectKindCatalog — round-trip', () => {
  it('bundled default catalog parses without throwing and all kinds have capability fields', () => {
    const catalog = validateWorldObjectKindCatalog(defaultCatalogJson);
    expect(catalog.kinds.length).toBeGreaterThan(0);
    for (const kind of catalog.kinds) {
      expect(kind).toHaveProperty('tilingAxes');
      expect(typeof kind.tilingAxes.x).toBe('boolean');
      expect(typeof kind.tilingAxes.y).toBe('boolean');
      expect(typeof kind.tilingAxes.z).toBe('boolean');
      expect(typeof kind.gravity).toBe('boolean');
      expect(typeof kind.isLayoutObject).toBe('boolean');
      expect(['none', 'static-batch', 'frustum-cull']).toContain(kind.optimization);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeKind — colliderShape: scanned-cuboids
// ---------------------------------------------------------------------------

describe('normalizeKind — scanned-cuboids colliderShape', () => {
  const validCuboids = [
    { min: [0, 0, 0], max: [0.5, 0.25, 1] },
    { min: [0.5, 0, 0], max: [1, 0.5, 1] },
  ];

  it('accepts a valid scanned-cuboids spec', () => {
    const kind = normalizeKind(
      minimalRaw('prototype', {
        colliderShape: { kind: 'scanned-cuboids', cuboids: validCuboids },
      }),
      0,
    );
    expect(kind.colliderShape).toEqual({
      kind: 'scanned-cuboids',
      cuboids: validCuboids,
    });
  });

  it('rejects the whole shape when any cuboid is malformed', () => {
    const cases: unknown[] = [
      // min >= max on an axis
      [{ min: [0, 0.5, 0], max: [1, 0.5, 1] }],
      // out-of-range coordinate (way beyond float-noise tolerance)
      [{ min: [0, 0, 0], max: [2, 1, 1] }],
      // non-numeric coordinate
      [{ min: [0, 'zero', 0], max: [1, 1, 1] }],
      // missing max
      [{ min: [0, 0, 0] }],
      // empty list
      [],
      // not an array
      { min: [0, 0, 0], max: [1, 1, 1] },
    ];
    for (const cuboids of cases) {
      const kind = normalizeKind(
        minimalRaw('prototype', {
          colliderShape: { kind: 'scanned-cuboids', cuboids },
        }),
        0,
      );
      expect(kind.colliderShape, JSON.stringify(cuboids)).toBeUndefined();
    }
  });

  it('rejects more cuboids than the review cap', () => {
    const tooMany = Array.from({ length: 257 }, (_, i) => ({
      min: [0, 0, i / 300],
      max: [1, 1, (i + 0.5) / 300],
    }));
    const kind = normalizeKind(
      minimalRaw('prototype', {
        colliderShape: { kind: 'scanned-cuboids', cuboids: tooMany },
      }),
      0,
    );
    expect(kind.colliderShape).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeKind — colliderShape: trimesh
// ---------------------------------------------------------------------------

describe('normalizeKind — trimesh colliderShape', () => {
  const validPositions = [0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1];
  const validIndices = [0, 1, 2, 1, 3, 2];

  it('accepts a valid trimesh spec', () => {
    const kind = normalizeKind(
      minimalRaw('prototype', {
        colliderShape: {
          kind: 'trimesh',
          positions: validPositions,
          indices: validIndices,
        },
      }),
      0,
    );
    expect(kind.colliderShape).toEqual({
      kind: 'trimesh',
      positions: validPositions,
      indices: validIndices,
    });
  });

  it('rejects the whole shape on any malformed payload', () => {
    const cases: Array<{ positions?: unknown; indices?: unknown }> = [
      // positions not a multiple of 3
      { positions: [0, 0], indices: validIndices },
      // index out of range
      { positions: validPositions, indices: [0, 1, 99] },
      // coordinate outside the normalized range
      { positions: [0, 0, 0, 5, 0, 0, 1, 1, 1], indices: [0, 1, 2] },
      // non-integer index
      { positions: validPositions, indices: [0, 1, 1.5] },
      // empty
      { positions: [], indices: [] },
      // missing indices
      { positions: validPositions },
    ];
    for (const colliderShape of cases) {
      const kind = normalizeKind(
        minimalRaw('prototype', {
          colliderShape: { kind: 'trimesh', ...colliderShape },
        }),
        0,
      );
      expect(kind.colliderShape, JSON.stringify(colliderShape)).toBeUndefined();
    }
  });
});
