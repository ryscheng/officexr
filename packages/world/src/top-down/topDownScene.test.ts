import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { classifyKind, type ArchetypeKind } from './furnitureArchetype.ts';
import { buildScene, deskSeatFor, sideOf, type ResolveInstance } from './topDownScene.ts';

const kind = (id: string, label: string, extra: Partial<ArchetypeKind> = {}): ArchetypeKind => ({
  id,
  label,
  category: 'furniture',
  isLayoutObject: false,
  ...extra,
});
const size = (width: number, depth: number, height: number) => ({ width, depth, height });
const seat = { offset: { x: 0, y: 0.5, z: 0 }, yawDeg: 0 };

describe('classifyKind', () => {
  it('splits structure into floors and walls by height', () => {
    expect(classifyKind(kind('a', 'Anything', { isLayoutObject: true }), size(4, 4, 0.1))).toBe('floor');
    expect(classifyKind(kind('b', 'Anything', { isLayoutObject: true }), size(4, 0.2, 3))).toBe('wall');
  });

  it('trusts the catalog flags before the name', () => {
    expect(classifyKind(kind('furniture_table_medium', 'Table Medium', { isDesk: true }), size(2, 1, 0.75))).toBe('desk');
    expect(classifyKind(kind('furniture_table_small', 'Table Small', { isDesk: true }), size(0.7, 0.7, 0.75))).toBe('table');
    expect(classifyKind(kind('furniture_couch', 'Couch', { seat }), size(3, 1.6, 1.2))).toBe('sofa');
    expect(classifyKind(kind('furniture_chair_a', 'Chair A', { seat }), size(0.75, 0.85, 1.25))).toBe('chair');
  });

  it('reads the name, specific words first', () => {
    const of = (id: string, label: string) => classifyKind(kind(id, label), size(1, 1, 1));
    expect(of('furniture_armchair_pillows', 'Armchair Pillows')).toBe('sofa');
    expect(of('furniture_cactus_small_a', 'Cactus Small A')).toBe('plant');
    expect(of('furniture_shelf_b_large', 'Shelf B Large')).toBe('shelf');
    expect(of('furniture_book_set', 'Book Set')).toBe('decor');
    expect(of('furniture_rug_oval_a', 'Rug Oval A')).toBe('rug');
    expect(of('furniture_lamp_standing', 'Lamp Standing')).toBe('lamp');
    expect(of('furniture_cabinet_medium', 'Cabinet Medium')).toBe('storage');
    expect(of('restaurant_table_round', 'Table Round')).toBe('table');
  });

  it('falls back on shape', () => {
    expect(classifyKind(kind('x', 'Mystery'), size(2, 2, 0.05))).toBe('rug');
    expect(classifyKind(kind('y', 'Mystery'), size(1, 1, 1))).toBe('block');
  });
});

describe('sideOf', () => {
  it('names the dominant direction, -Z being north', () => {
    expect(sideOf({ x: 0, z: -1 })).toBe('n');
    expect(sideOf({ x: 0, z: 1 })).toBe('s');
    expect(sideOf({ x: 1, z: 0.2 })).toBe('e');
    expect(sideOf({ x: -1, z: 0 })).toBe('w');
  });
});

describe('deskSeatFor', () => {
  const desk = { min: { x: 0, z: 0 }, max: { x: 2, z: 1 } };

  it('finds the side a chair is pulled up to, and how far along it', () => {
    expect(deskSeatFor(desk, { min: { x: 0.2, z: 1.1 }, max: { x: 0.8, z: 1.7 } })).toEqual({ side: 's', t: 0.25 });
    expect(deskSeatFor(desk, { min: { x: 1.2, z: -0.7 }, max: { x: 1.8, z: -0.1 } })).toEqual({ side: 'n', t: 0.75 });
    expect(deskSeatFor(desk, { min: { x: 2.1, z: 0.2 }, max: { x: 2.7, z: 0.8 } })).toEqual({ side: 'e', t: 0.5 });
  });

  it('ignores chairs across the room', () => {
    expect(deskSeatFor(desk, { min: { x: 0.2, z: 4 }, max: { x: 0.8, z: 4.6 } })).toBeNull();
  });
});

describe('buildScene', () => {
  const kinds: Record<string, { kind: ArchetypeKind; aabb: { min: [number, number, number]; max: [number, number, number] } }> = {
    floor: { kind: kind('floor', 'Floor', { isLayoutObject: true }), aabb: { min: [-5, -0.1, -5], max: [5, 0, 5] } },
    desk: { kind: kind('desk', 'Desk', { isDesk: true }), aabb: { min: [0, 0, 0], max: [2, 0.75, 1] } },
    chair: { kind: kind('chair', 'Chair', { seat }), aabb: { min: [0.7, 0, 1.1], max: [1.3, 1.2, 1.7] } },
  };
  const resolve: ResolveInstance = (inst) => kinds[inst.kindId] ?? null;
  const inst = (id: string, kindId: string, yawDeg?: number): ObjectInstance => ({ id, sourceCommandId: id, kindId, position: [0, 0, 0], yawDeg });

  it('splits floors from standing items, skips unresolved instances and fits the bounds', () => {
    const scene = buildScene([inst('f', 'floor'), inst('d', 'desk'), inst('?', 'unknown')], resolve, []);
    expect(scene.floors.map((i) => i.id)).toEqual(['f']);
    expect(scene.items.map((i) => i.id)).toEqual(['d']);
    expect(scene.bounds).toEqual({ min: { x: -5, z: -5 }, max: { x: 5, z: 5 } });
  });

  it('puts a chair’s backrest behind the sitter: south at yaw 0, north at 180', () => {
    const scene = buildScene([inst('c0', 'chair'), inst('c180', 'chair', 180)], resolve, []);
    expect(scene.byId.get('c0')?.back).toBe('s');
    expect(scene.byId.get('c180')?.back).toBe('n');
  });

  it('gives a desk a workstation for each chair pulled up to it', () => {
    const scene = buildScene([inst('d', 'desk'), inst('c', 'chair')], resolve, []);
    expect(scene.byId.get('d')?.seats).toEqual([{ side: 's', t: 0.5 }]);
  });
});
