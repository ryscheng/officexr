import { describe, expect, it } from 'vitest';
import { SPELL_COOLDOWN_MS, type ObjectInstance, type PlacedProp } from '@officexr/sdk';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import { boltAt, landingPoint } from './bolt.ts';
import { buildCast } from './cast.ts';
import { createPlaceMode, fitsClear, ghostSpot, pickPlaced, TARGET_REACH_M } from './place-mode.ts';
import { newItemsState, stepSelfItems, type ItemsInput } from './self-items.ts';
import { heldStands, nearestWandStand, swapHeldStands } from './wand.ts';

const instance = (id: string, kindId: string, position: [number, number, number] = [0, 0, 0], yawDeg = 0): ObjectInstance =>
  ({ id, sourceCommandId: id, kindId, position, yawDeg }) as ObjectInstance;

const kinds: Record<string, Partial<WorldObjectKind>> = {
  stand: { holdable: { item: 'wand', emptyKindId: 'stand_empty' } },
  stand_empty: {},
  chair: {},
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };

/** One voxel is 2 m; every footprint is 2 m square for these tests, 4 m wide when turned a quarter. */
const geometry = {
  voxelSize: 2,
  worldAABB: (position: readonly number[], _kind: string, yawDeg = 0) => {
    const turned = yawDeg % 180 !== 0;
    const w = turned ? 4 : 2;
    const d = turned ? 2 : 4;
    return { min: [position[0] * 2, position[1] * 2, position[2] * 2] as const, max: [position[0] * 2 + w, position[1] * 2 + 1, position[2] * 2 + d] as const };
  },
  worldAABBOfInstance(i: ObjectInstance) {
    return this.worldAABB(i.position, i.kindId, i.yawDeg);
  },
};

describe('wand stands', () => {
  const stands = [instance('s1', 'stand', [1, 0, 1]), instance('s2', 'stand', [10, 0, 10]), instance('c', 'chair', [1, 0, 1])];

  it('finds the free stand within reach and skips a stand someone holds the wand of', () => {
    expect(nearestWandStand(stands, catalog, geometry, { x: 2.5, y: 0, z: 2.5 })?.id).toBe('s1');
    expect(nearestWandStand(stands, catalog, geometry, { x: 2.5, y: 0, z: 2.5 }, undefined, new Set(['s1']))).toBeNull();
    expect(nearestWandStand(stands, catalog, geometry, { x: 9, y: 0, z: 9 })).toBeNull();
  });

  it('draws a held stand as its empty kind and leaves everything else alone', () => {
    const world = { cubeSize: 2, instances: stands };
    const swapped = swapHeldStands(world, catalog, new Set(['s1']));
    expect(swapped.instances.map((i) => i.kindId)).toEqual(['stand_empty', 'stand', 'chair']);
    expect(swapHeldStands(world, catalog, new Set())).toBe(world);
    expect(swapHeldStands(world, catalog, new Set(['c']))).toBe(world);
  });

  it('lists held stands in a stable string', () => {
    expect(heldStands({ a: { heldStand: 's2' }, b: { heldStand: null }, c: { heldStand: 's1' }, d: {} })).toBe('s1|s2');
  });
});

describe('self items', () => {
  const base: ItemsInput = { now: 10_000, fPressed: false, castPressed: false, digitSpell: null, holding: false, posed: false, seated: false, standNear: null };

  it('F picks the wand up at a stand and keeps the same press from mounting', () => {
    const out = stepSelfItems(newItemsState(), { ...base, fPressed: true, standNear: 's1' });
    expect(out).toEqual({ action: { kind: 'pickup', standId: 's1' }, suppressMount: true, suppressPoke: false });
  });

  it('F does nothing for the wand without a stand, while riding or seated, and lets a ride mount through', () => {
    expect(stepSelfItems(newItemsState(), { ...base, fPressed: true }).action).toBeNull();
    expect(stepSelfItems(newItemsState(), { ...base, fPressed: true }).suppressMount).toBe(false);
    expect(stepSelfItems(newItemsState(), { ...base, fPressed: true, standNear: 's1', posed: true }).action).toBeNull();
    expect(stepSelfItems(newItemsState(), { ...base, fPressed: true, standNear: 's1', seated: true }).action).toBeNull();
  });

  it('F puts the wand back anywhere, and poke becomes a cast while holding', () => {
    const state = newItemsState();
    expect(stepSelfItems(state, { ...base, holding: true, fPressed: true }).action).toEqual({ kind: 'putback' });
    const cast = stepSelfItems(state, { ...base, holding: true, castPressed: true });
    expect(cast.action).toEqual({ kind: 'cast', spell: 'fireball' });
    expect(cast.suppressPoke).toBe(true);
  });

  it('casts only while holding the wand, once per cooldown', () => {
    const state = newItemsState();
    expect(stepSelfItems(state, { ...base, castPressed: true }).action).toBeNull();
    expect(stepSelfItems(state, { ...base, holding: true, castPressed: true }).action?.kind).toBe('cast');
    expect(stepSelfItems(state, { ...base, holding: true, castPressed: true, now: 10_000 + SPELL_COOLDOWN_MS - 1 }).action).toBeNull();
    expect(stepSelfItems(state, { ...base, holding: true, castPressed: true, now: 10_000 + SPELL_COOLDOWN_MS }).action?.kind).toBe('cast');
  });

  it('does not cast while riding or swimming', () => {
    const out = stepSelfItems(newItemsState(), { ...base, holding: true, posed: true, castPressed: true });
    expect(out.action).toBeNull();
    expect(out.suppressPoke).toBe(true);
  });

  it('digits choose the spell only while holding, and the next cast uses it', () => {
    const state = newItemsState();
    stepSelfItems(state, { ...base, digitSpell: 'shrink' });
    expect(state.spell).toBe('fireball');
    stepSelfItems(state, { ...base, holding: true, digitSpell: 'levitate' });
    expect(stepSelfItems(state, { ...base, holding: true, castPressed: true }).action).toEqual({ kind: 'cast', spell: 'levitate' });
  });
});

describe('buildCast', () => {
  const caster = { feet: { x: 0, y: 0, z: 0 }, yaw: Math.PI };
  const open = () => 100;

  it('fires from the wand tip along the facing, to the spell range in the open', () => {
    const cast = buildCast('fireball', caster, [], open);
    expect(cast.dir.z).toBeCloseTo(1);
    expect(cast.origin.z).toBeCloseTo(0.55);
    expect(cast).toMatchObject({ spell: 'fireball', distance: 10, targetId: null });
  });

  it('stops at a wall and at the first player on the line', () => {
    expect(buildCast('fireball', caster, [], () => 4).distance).toBe(4);
    const cast = buildCast(
      'fireball',
      caster,
      [
        { id: 'far', feet: { x: 0, y: 0, z: 8 } },
        { id: 'near', feet: { x: 0.2, y: 0, z: 5 } },
        { id: 'aside', feet: { x: 3, y: 0, z: 3 } },
      ],
      open,
    );
    expect(cast.targetId).toBe('near');
    expect(cast.distance).toBeCloseTo(5 - 0.55, 1);
  });

  it('a player behind a wall is not hit', () => {
    const cast = buildCast('fireball', caster, [{ id: 'hidden', feet: { x: 0, y: 0, z: 6 } }], () => 3);
    expect(cast).toMatchObject({ targetId: null, distance: 3 });
  });
});

describe('bolt flight', () => {
  const cast = { spell: 'fireball' as const, origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 }, distance: 8, targetId: null };

  it('flies at the spell speed and lands after distance over speed', () => {
    expect(boltAt(cast, 500).position.z).toBeCloseTo(4);
    expect(boltAt(cast, 500).landed).toBe(false);
    expect(boltAt(cast, 1000)).toMatchObject({ progress: 1, landed: true });
    expect(boltAt(cast, 5000).position.z).toBeCloseTo(8);
    expect(landingPoint(cast)).toEqual({ x: 0, y: 1, z: 8 });
  });

  it('lands at once for a zero-length shot', () => {
    expect(boltAt({ ...cast, distance: 0 }, 0).landed).toBe(true);
  });
});

describe('place mode', () => {
  const placed: PlacedProp[] = [
    { id: 'placed:a', kindId: 'prop_pool', position: [5, 0, 5], yawDeg: 0 },
    { id: 'placed:b', kindId: 'prop_pool', position: [20, 0, 20], yawDeg: 0 },
  ];

  it('puts the ghost on the grid in front of the player, at floor height', () => {
    const spot = ghostSpot(geometry, 2, { x: 0, y: 4.04, z: 0 }, Math.PI, 'prop_pool', 0);
    expect(spot[0]).toBeCloseTo(-0.5);
    expect(spot[1]).toBe(2);
    expect(spot[2]).toBeCloseTo(0.5);
    for (const v of [spot[0], spot[2]]) expect(Number.isInteger(v * 2)).toBe(true);
  });

  it('is clear of placed props until it overlaps one, and ignores the prop being moved', () => {
    expect(fitsClear(geometry, placed, 'prop_pool', [0, 0, 0], 0)).toBe(true);
    expect(fitsClear(geometry, placed, 'prop_pool', [5, 0, 5.5], 0)).toBe(false);
    expect(fitsClear(geometry, placed, 'prop_pool', [5, 0, 5.5], 0, 'placed:a')).toBe(true);
  });

  it('points at the prop under the aim point, else the nearest in reach, else nothing', () => {
    expect(pickPlaced(geometry, placed, { x: 11, z: 11 })).toBe('placed:a');
    expect(pickPlaced(geometry, placed, { x: 12 + TARGET_REACH_M + 0.5, z: 11 })).toBeNull();
    expect(pickPlaced(geometry, placed, { x: 41, z: 41 })).toBe('placed:b');
  });

  it('keeps its state in a small store: open, kind, turning in quarter turns, ghost', () => {
    const mode = createPlaceMode();
    let calls = 0;
    mode.subscribe(() => calls++);
    mode.setOpen(true);
    mode.selectKind('prop_wand_stand');
    for (let i = 0; i < 5; i++) mode.rotate();
    expect(mode.get()).toMatchObject({ open: true, kindId: 'prop_wand_stand', yawDeg: 90 });
    const ghost = { position: [1, 2, 3] as [number, number, number], valid: true, targetId: null };
    mode.setGhost(ghost);
    const before = calls;
    mode.setGhost({ ...ghost });
    expect(calls).toBe(before);
    mode.setOpen(false);
    expect(mode.get()).toMatchObject({ open: false, ghost: null });
  });
});
