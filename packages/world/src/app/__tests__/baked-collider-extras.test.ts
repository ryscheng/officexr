/**
 * Unit tests for the baked-collider extras schema — the writer
 * (`buildColliderExtras`, used by `bakeLayout`) and the defensive
 * reader (`parseEmbeddedColliders`, used by `BakedLayoutColliders`).
 * Covers the v2 (cuboids + trimeshes) format and v1 back-compat.
 */
import { describe, it, expect } from 'vitest';
import {
  BAKED_COLLIDERS_VERSION,
  buildColliderExtras,
  parseEmbeddedColliders,
} from '../baked-collider-extras.ts';
import type { ColliderDescriptor } from '../../physics/rules.ts';

const CUBOIDS: ColliderDescriptor[] = [
  {
    type: 'cuboid',
    center: { x: 1, y: 2, z: 3 },
    halfExtents: { x: 0.5, y: 1, z: 0.5 },
  },
  {
    type: 'cuboid',
    center: { x: -4, y: 0, z: 8 },
    halfExtents: { x: 2, y: 2, z: 2 },
  },
];

const TRIMESH: ColliderDescriptor = {
  type: 'trimesh',
  vertices: [4, 2, 0, 4, 2, 4, 0, 6, 0, 0, 6, 4],
  indices: [0, 1, 2, 1, 3, 2],
};

describe('baked-collider extras (v2)', () => {
  it('round-trips cuboids + trimeshes: parse(build(x)) === x', () => {
    const extras = buildColliderExtras([...CUBOIDS, TRIMESH]);
    const viaJson = JSON.parse(JSON.stringify(extras));
    const parsed = parseEmbeddedColliders(viaJson);
    expect(parsed).not.toBeNull();
    // Writer groups cuboids first, then trimeshes.
    expect(parsed).toEqual([...CUBOIDS, TRIMESH]);
  });

  it('writes the current version', () => {
    expect(buildColliderExtras([]).officexr.colliders.version).toBe(
      BAKED_COLLIDERS_VERSION,
    );
  });

  it('accepts a v1 payload (cuboids only, no trimeshes field)', () => {
    const v1 = {
      officexr: {
        colliders: {
          version: 1,
          cuboids: [
            { center: { x: 1, y: 2, z: 3 }, halfExtents: { x: 1, y: 1, z: 1 } },
          ],
        },
      },
    };
    const parsed = parseEmbeddedColliders(v1);
    expect(parsed).toEqual([
      {
        type: 'cuboid',
        center: { x: 1, y: 2, z: 3 },
        halfExtents: { x: 1, y: 1, z: 1 },
      },
    ]);
  });

  it('returns null for userData without our namespace', () => {
    expect(parseEmbeddedColliders(undefined)).toBeNull();
    expect(parseEmbeddedColliders(null)).toBeNull();
    expect(parseEmbeddedColliders({})).toBeNull();
    expect(parseEmbeddedColliders({ somethingElse: true })).toBeNull();
    expect(parseEmbeddedColliders('officexr')).toBeNull();
  });

  it('returns null for an unknown schema version', () => {
    const extras = buildColliderExtras(CUBOIDS);
    extras.officexr.colliders.version = BAKED_COLLIDERS_VERSION + 1;
    expect(parseEmbeddedColliders(extras)).toBeNull();
  });

  it('returns null for malformed cuboid entries', () => {
    const missingHalfExtents = {
      officexr: {
        colliders: {
          version: 2,
          cuboids: [{ center: { x: 0, y: 0, z: 0 } }],
          trimeshes: [],
        },
      },
    };
    expect(parseEmbeddedColliders(missingHalfExtents)).toBeNull();

    const nonNumeric = {
      officexr: {
        colliders: {
          version: 2,
          cuboids: [
            {
              center: { x: 'zero', y: 0, z: 0 },
              halfExtents: { x: 1, y: 1, z: 1 },
            },
          ],
          trimeshes: [],
        },
      },
    };
    expect(parseEmbeddedColliders(nonNumeric)).toBeNull();
  });

  it('returns null for malformed trimesh entries', () => {
    const base = { version: 2, cuboids: [] };
    const cases: unknown[] = [
      [{ vertices: [0, 0], indices: [0, 1, 2] }], // not /3
      [{ vertices: [0, 0, 0, 1, 1, 1, 2, 2, 2], indices: [0, 1, 5] }], // index OOB
      [{ vertices: [0, 0, Number.NaN], indices: [0, 0, 0] }], // non-finite
      [{ indices: [0, 1, 2] }], // missing vertices
      'not-an-array',
    ];
    for (const trimeshes of cases) {
      expect(
        parseEmbeddedColliders({ officexr: { colliders: { ...base, trimeshes } } }),
        JSON.stringify(trimeshes),
      ).toBeNull();
    }
  });

  it('accepts an empty collider list (a bake with no colliders is valid)', () => {
    expect(parseEmbeddedColliders(buildColliderExtras([]))).toEqual([]);
  });
});
