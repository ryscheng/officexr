/**
 * Unit tests for the baked-collider extras schema — the writer
 * (`buildColliderExtras`, used by `bakeLayout`) and the defensive
 * reader (`parseEmbeddedColliders`, used by `BakedLayoutColliders`).
 */
import { describe, it, expect } from 'vitest';
import {
  BAKED_COLLIDERS_VERSION,
  buildColliderExtras,
  parseEmbeddedColliders,
} from '../baked-collider-extras.ts';
import type { CuboidDescriptor } from '../../physics/rules.ts';

const CUBOIDS: CuboidDescriptor[] = [
  { center: { x: 1, y: 2, z: 3 }, halfExtents: { x: 0.5, y: 1, z: 0.5 } },
  { center: { x: -4, y: 0, z: 8 }, halfExtents: { x: 2, y: 2, z: 2 } },
];

describe('baked-collider extras', () => {
  it('round-trips: parse(build(cuboids)) === cuboids', () => {
    const extras = buildColliderExtras(CUBOIDS);
    // Simulate the GLB round-trip (extras are serialised as plain JSON
    // and surface as `userData` on the loaded three.js scene).
    const viaJson = JSON.parse(JSON.stringify(extras));
    expect(parseEmbeddedColliders(viaJson)).toEqual(CUBOIDS);
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
          version: BAKED_COLLIDERS_VERSION,
          cuboids: [{ center: { x: 0, y: 0, z: 0 } }],
        },
      },
    };
    expect(parseEmbeddedColliders(missingHalfExtents)).toBeNull();

    const nonNumeric = {
      officexr: {
        colliders: {
          version: BAKED_COLLIDERS_VERSION,
          cuboids: [
            {
              center: { x: 'zero', y: 0, z: 0 },
              halfExtents: { x: 1, y: 1, z: 1 },
            },
          ],
        },
      },
    };
    expect(parseEmbeddedColliders(nonNumeric)).toBeNull();

    const notAnArray = {
      officexr: {
        colliders: { version: BAKED_COLLIDERS_VERSION, cuboids: {} },
      },
    };
    expect(parseEmbeddedColliders(notAnArray)).toBeNull();
  });

  it('accepts an empty cuboid list (a bake with no colliders is valid)', () => {
    expect(parseEmbeddedColliders(buildColliderExtras([]))).toEqual([]);
  });
});
