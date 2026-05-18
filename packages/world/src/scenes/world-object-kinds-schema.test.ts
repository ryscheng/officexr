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
