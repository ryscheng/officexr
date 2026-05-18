/**
 * Hermetic geometric assertions on compiled room / map content.
 *
 * Disentangles two confusions that have caused regressions:
 *   1. "voxel size = object size" — broken after the 2 m → 0.5 m grid
 *      migration. The renderer (and especially compile-time stride for
 *      extrude commands) must consult per-kind `dimensions`, not
 *      `voxelSize`.
 *   2. Visual-only verification — a screenshot says "it looks right"
 *      but a 0.5 m gap inside a 2 m cube isn't visible. This test
 *      computes the world-space AABB of every instance and asserts the
 *      whole composed scene matches the design spec.
 *
 * Reads JSON fixtures (rooms + maps + the live world-object catalog)
 * directly and compiles via the same pure `compileScene` /
 * `compileMap` the runtime uses.
 */
import { describe, it, expect } from 'vitest';

import platformRoomJson from '../../rooms/platform.json' with { type: 'json' };
import defaultV2RoomJson from '../../rooms/default-v2.json' with { type: 'json' };
import longCorridorMapJson from '../../maps/long_corridor.json' with { type: 'json' };
import platformLayoutJson from '../../layouts/platform.json' with { type: 'json' };
import longCorridorLayoutJson from '../../layouts/long_corridor.json' with { type: 'json' };
import catalogJson from '../../world-object-kinds.json' with { type: 'json' };

import { compileScene, type KindStrideLookup } from './compile.ts';
import { compileMap } from './compile-map.ts';
import { deserializeScene, deserializeMap, migrateToV5 } from './serialize.ts';
import { deserializeLayout, type LayoutDocument } from './layout-document.ts';
import type { RoomDocument } from './commands.ts';
import type { ObjectInstance } from '@officexr/sdk';
import {
  validateWorldObjectKindCatalog,
  type WorldObjectKind,
} from './world-object-kinds-schema.ts';

const VOXEL_SIZE = 0.5;

/** Stride lookup that reads directly from the on-disk catalog so the
 * test is independent of `object-kind-catalog.ts` module state (the
 * default catalog has only 12 kinds; the live JSON has 281). */
function buildStrideLookup(): {
  kindStride: KindStrideLookup;
  kindById: Map<string, WorldObjectKind>;
} {
  const catalog = validateWorldObjectKindCatalog(catalogJson);
  const kindById = new Map(catalog.kinds.map((k) => [k.id, k]));

  const kindStride: KindStrideLookup = (id) => {
    const kind = kindById.get(id);
    if (!kind?.dimensions) return [1, 1, 1];
    const { width, height, depth } = kind.dimensions;
    return [
      Math.max(1, Math.round(width / VOXEL_SIZE)),
      Math.max(1, Math.round(height / VOXEL_SIZE)),
      Math.max(1, Math.round(depth / VOXEL_SIZE)),
    ];
  };

  return { kindStride, kindById };
}

/** World-space AABB of a single compiled ObjectInstance. The position
 * is the voxel-coord anchor (lower corner); dimensions are in metres,
 * already post-`scale`. */
function instanceAABB(
  inst: { position: readonly [number, number, number]; kindId: string },
  kindById: Map<string, WorldObjectKind>,
): { min: [number, number, number]; max: [number, number, number] } {
  const kind = kindById.get(inst.kindId);
  const dims = kind?.dimensions ?? {
    width: VOXEL_SIZE,
    height: VOXEL_SIZE,
    depth: VOXEL_SIZE,
  };
  const [vx, vy, vz] = inst.position;
  const ax = vx * VOXEL_SIZE;
  const ay = vy * VOXEL_SIZE;
  const az = vz * VOXEL_SIZE;
  return {
    min: [ax, ay, az],
    max: [ax + dims.width, ay + dims.height, az + dims.depth],
  };
}

function unionAABB(
  boxes: ReadonlyArray<{ min: [number, number, number]; max: [number, number, number] }>,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let a = 0; a < 3; a++) {
      if (b.min[a] < min[a]) min[a] = b.min[a];
      if (b.max[a] > max[a]) max[a] = b.max[a];
    }
  }
  return { min, max };
}

function extents(box: {
  min: [number, number, number];
  max: [number, number, number];
}): [number, number, number] {
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}

/** Two AABBs overlap iff they intersect on all three axes with non-zero
 * volume. Touching faces (max == min) are NOT considered an overlap —
 * adjacent cubes should pass. */
function overlaps(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): boolean {
  const EPS = 1e-6;
  for (let axis = 0; axis < 3; axis++) {
    if (a.max[axis] - b.min[axis] <= EPS) return false;
    if (b.max[axis] - a.min[axis] <= EPS) return false;
  }
  return true;
}

function findOverlapping(
  insts: ReadonlyArray<{
    id: string;
    position: readonly [number, number, number];
    kindId: string;
  }>,
  kindById: Map<string, WorldObjectKind>,
): Array<{ a: string; b: string }> {
  const boxes = insts.map((i) => ({ id: i.id, box: instanceAABB(i, kindById) }));
  const out: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i].box, boxes[j].box)) {
        out.push({ a: boxes[i].id, b: boxes[j].id });
      }
    }
  }
  return out;
}

/** Compile the room together with its referenced layout. Mirrors the
 * runtime semantics: layout commands provide the structural geometry,
 * room commands provide the non-layout (furniture) overlays. */
function compileRoomWithLayout(
  room: RoomDocument,
  layout: LayoutDocument | null,
  kindStride: KindStrideLookup,
): ObjectInstance[] {
  const roomCompiled = compileScene(room, VOXEL_SIZE, kindStride);
  if (!layout) return [...roomCompiled.instances];
  const layoutCompiled = compileScene(layout, VOXEL_SIZE, kindStride);
  return [...layoutCompiled.instances, ...roomCompiled.instances];
}

describe('room render bounds', () => {
  const { kindStride, kindById } = buildStrideLookup();

  it('platform room + layout compiles to a 50 m × 50 m × 2 m slab', () => {
    const doc = migrateToV5(deserializeScene(platformRoomJson));
    const layout = deserializeLayout(platformLayoutJson);
    const instances = compileRoomWithLayout(doc, layout, kindStride);

    expect(instances.length).toBeGreaterThan(0);

    const aabb = unionAABB(instances.map((i) => instanceAABB(i, kindById)));
    const [w, h, d] = extents(aabb);

    // 25 × 25 grid of 2 m colored_block_blue cubes.
    expect(w).toBeCloseTo(50, 5);
    expect(d).toBeCloseTo(50, 5);
    expect(h).toBeCloseTo(2, 5);

    const overlapsFound = findOverlapping(instances, kindById);
    expect(overlapsFound).toEqual([]);
  });

  it('default-v2 room + long_corridor layout compiles to an 8 m × 4 m × 2 m corridor', () => {
    const doc = migrateToV5(deserializeScene(defaultV2RoomJson));
    const layout = deserializeLayout(longCorridorLayoutJson);
    const instances = compileRoomWithLayout(doc, layout, kindStride);

    expect(instances.length).toBeGreaterThan(0);

    const aabb = unionAABB(instances.map((i) => instanceAABB(i, kindById)));
    const [w, h, d] = extents(aabb);

    // 2 wide × 4 long × 1 tall arrangement of 2 m cubes.
    // Width / depth label here just means the room's local X / Z; the
    // long axis is Z.
    expect(w).toBeCloseTo(4, 5);
    expect(d).toBeCloseTo(8, 5);
    expect(h).toBeCloseTo(2, 5);

    const overlapsFound = findOverlapping(instances, kindById);
    expect(overlapsFound).toEqual([]);
  });

  it('long_corridor map composes to the same 8 m × 4 m × 2 m AABB', () => {
    const map = deserializeMap(longCorridorMapJson);
    const room = migrateToV5(deserializeScene(defaultV2RoomJson));
    const layout = deserializeLayout(longCorridorLayoutJson);
    const rooms = new Map([[room.name, room]]);

    // compileMap operates on the room commands only; to verify the
    // composed map's geometry we add the layout's instances at the
    // room-instance origin (the long_corridor map places the room at a
    // non-zero offset, so apply it here).
    const mapCompiled = compileMap(map, rooms, VOXEL_SIZE, kindStride);
    const layoutCompiled = compileScene(layout, VOXEL_SIZE, kindStride);
    const ri = map.rooms[0];
    const offset = ri.position;
    const offsetLayoutInstances = layoutCompiled.instances.map((inst) => ({
      ...inst,
      position: [
        inst.position[0] + offset[0],
        inst.position[1] + offset[1],
        inst.position[2] + offset[2],
      ] as [number, number, number],
    }));
    const instances = [...offsetLayoutInstances, ...mapCompiled.instances];

    expect(instances.length).toBeGreaterThan(0);

    const aabb = unionAABB(instances.map((i) => instanceAABB(i, kindById)));
    const [w, h, d] = extents(aabb);

    expect(w).toBeCloseTo(4, 5);
    expect(d).toBeCloseTo(8, 5);
    expect(h).toBeCloseTo(2, 5);

    const overlapsFound = findOverlapping(instances, kindById);
    expect(overlapsFound).toEqual([]);
  });
});
