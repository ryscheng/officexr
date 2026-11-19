import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import { pickPokeTarget, POKE_REACH_M, yawToward } from './poke.ts';
import { POSE_VISUALS } from './poseVisual.ts';
import { leanOf, newRide, nearestRideStand, RIDE_STRATEGIES, rideDirection, stepRide } from './ride.ts';
import { newSelfMotion, stepSelfMotion, type MotionWorld, type SelfMotionInput } from './self-motion.ts';
import {
  AT_REST,
  floatSway,
  floatTarget,
  MIN_LIFT,
  PRONE_PITCH,
  stepPitch,
  stepBuoyancy,
  SWIM_STRATEGIES,
  swimStateForInput,
  swimStateOf,
} from './swim.ts';
import { waterAt, waterVolumes } from './water.ts';

const instance = (id: string, kindId: string): ObjectInstance =>
  ({ id, sourceCommandId: id, kindId, position: [0, 0, 0] }) as ObjectInstance;

const kinds: Record<string, Partial<WorldObjectKind>> = {
  pool: { water: { surfaceHeight: 0.4, rim: 0.35 } },
  scooter: { ride: { vehicle: 'scooter' } },
  chair: {},
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = {
  worldAABBOfInstance: (i: ObjectInstance) =>
    i.id === 'pool-1'
      ? { min: [0, 0, 0] as const, max: [6, 0.5, 4] as const }
      : { min: [10, 0, 10] as const, max: [11, 0.5, 10.4] as const },
};

describe('waterVolumes', () => {
  const volumes = waterVolumes([instance('pool-1', 'pool'), instance('c', 'chair')], catalog, geometry);

  it('makes one volume per water object, inside its rim', () => {
    expect(volumes).toEqual([
      { id: 'pool-1', minX: 0.35, maxX: 5.65, minZ: 0.35, maxZ: 3.65, baseY: 0, surfaceY: 0.4 },
    ]);
  });

  it('makes no water for a pool turned off the quarter turns', () => {
    expect(waterVolumes([{ ...instance('pool-1', 'pool'), yawDeg: 45 }], catalog, geometry)).toEqual([]);
    expect(waterVolumes([{ ...instance('pool-1', 'pool'), yawDeg: 270 }], catalog, geometry)).toHaveLength(1);
  });

  it('finds the water under a point and nothing at the rim or outside', () => {
    expect(waterAt(volumes, 3, 2)?.id).toBe('pool-1');
    expect(waterAt(volumes, 0.2, 2)).toBeNull();
    expect(waterAt(volumes, 9, 9)).toBeNull();
  });
});

describe('swim', () => {
  it('picks the stroke from speed and from input', () => {
    expect(swimStateOf(0)).toBe('tread');
    expect(swimStateOf(2.2)).toBe('paddle');
    expect(swimStateOf(3.4)).toBe('stroke');
    expect(swimStateForInput(false, true)).toBe('tread');
    expect(swimStateForInput(true, false)).toBe('paddle');
    expect(swimStateForInput(true, true)).toBe('stroke');
  });

  it('rides a floating back a little under the surface and a crawling front a little over the axis', () => {
    expect(floatTarget(0.4, 0, 'tread', 0)).toBeCloseTo(0.4 - SWIM_STRATEGIES.tread.sink, 5);
    expect(floatTarget(0.4, 0, 'paddle', 0)).toBeGreaterThan(floatTarget(0.4, 0, 'tread', 0));
  });

  it('bobs a few centimetres about once every two seconds', () => {
    const heights = Array.from({ length: 200 }, (_, n) => floatTarget(1, 0, 'tread', n * 0.01));
    const swing = Math.max(...heights) - Math.min(...heights);
    expect(swing).toBeGreaterThan(0.04);
    expect(swing).toBeLessThan(0.07);
    expect(floatTarget(1, 0, 'tread', 0)).toBeCloseTo(floatTarget(1, 0, 'tread', 2), 2);
  });

  it('sways slowly and only a little', () => {
    const sways = Array.from({ length: 100 }, (_, n) => floatSway(n * 0.1));
    expect(Math.max(...sways)).toBeLessThan(0.1);
    expect(Math.min(...sways)).toBeGreaterThan(-0.1);
  });

  it('turns from on its back to face down over about 0.4 s without overshooting', () => {
    let pitch = -PRONE_PITCH;
    for (let n = 0; n < 24; n++) pitch = stepPitch(pitch, PRONE_PITCH, 1 / 60);
    const settled = (pitch + PRONE_PITCH) / (2 * PRONE_PITCH);
    expect(settled).toBeGreaterThan(0.9);
    expect(settled).toBeLessThan(1);
    expect(stepPitch(0.5, 0.5, 1 / 60)).toBeCloseTo(0.5);
  });

  it('never lowers the body further than the floor can hide', () => {
    expect(floatTarget(0.4, 3, 'tread', 0)).toBe(MIN_LIFT);
  });

  it('settles on the float height without overshooting wildly', () => {
    let b = AT_REST;
    let peak = 0;
    for (let n = 0; n < 240; n++) {
      b = stepBuoyancy(b, 0.2, 1 / 60);
      peak = Math.max(peak, b.lift);
    }
    expect(b.lift).toBeCloseTo(0.2, 3);
    expect(peak).toBeLessThan(0.24);
  });

  it('stays finite on a long frame', () => {
    const b = stepBuoyancy(AT_REST, 0.3, 5);
    expect(Number.isFinite(b.lift)).toBe(true);
    expect(b.lift).toBeLessThan(0.6);
  });
});

describe('ride', () => {
  const run = (vehicle: 'scooter' | 'tricycle', seconds: number) => {
    let r = newRide(0);
    for (let n = 0; n < seconds * 60; n++) r = stepRide(r, vehicle, { dir: { x: 0, z: 1 }, sprint: false }, 1 / 60);
    return r;
  };

  it('reaches each vehicle top speed and no more', () => {
    expect(run('scooter', 5).speed).toBeCloseTo(RIDE_STRATEGIES.scooter.topSpeed, 5);
    expect(run('tricycle', 5).speed).toBeCloseTo(RIDE_STRATEGIES.tricycle.topSpeed, 5);
    expect(RIDE_STRATEGIES.scooter.topSpeed).toBeGreaterThan(RIDE_STRATEGIES.tricycle.topSpeed);
  });

  it('coasts to a stop and keeps its heading when the input is released', () => {
    let r = run('scooter', 3);
    const heading = r.heading;
    for (let n = 0; n < 120; n++) r = stepRide(r, 'scooter', { dir: null, sprint: false }, 1 / 60);
    expect(r.speed).toBe(0);
    expect(r.heading).toBe(heading);
  });

  it('turns toward the wanted direction at a limited rate', () => {
    const r = stepRide(newRide(0), 'scooter', { dir: { x: 1, z: 0 }, sprint: false }, 0.1);
    expect(r.heading).toBeGreaterThan(0);
    expect(r.heading).toBeLessThan(Math.PI / 2);
    expect(r.yawRate).toBeGreaterThan(0);
  });

  it('leans a scooter into a turn but not a tricycle', () => {
    expect(leanOf('scooter', 2, 8)).toBeGreaterThan(0);
    expect(leanOf('scooter', 20, 8)).toBe(RIDE_STRATEGIES.scooter.leanMax);
    expect(leanOf('tricycle', 2, 3)).toBe(0);
  });

  it('points along its heading', () => {
    const d = rideDirection({ heading: Math.PI / 2, speed: 1, yawRate: 0 });
    expect(d.x).toBeCloseTo(1);
    expect(d.z).toBeCloseTo(0);
  });

  it('skips a rack another player already rides from', () => {
    const racks = [instance('s', 'scooter')];
    const near = { x: 10.5, y: 0, z: 11.2 };
    expect(nearestRideStand(racks, catalog, geometry, near, undefined, new Set(['s']))).toBeNull();
    expect(nearestRideStand(racks, catalog, geometry, near, undefined, new Set(['other']))?.vehicle).toBe('scooter');
  });

  it('finds a rack within reach and none beyond it', () => {
    const racks = [instance('s', 'scooter'), instance('c', 'chair')];
    expect(nearestRideStand(racks, catalog, geometry, { x: 10.5, y: 0, z: 11.2 })?.vehicle).toBe('scooter');
    expect(nearestRideStand(racks, catalog, geometry, { x: 10.5, y: 0, z: 14 })).toBeNull();
  });
});

describe('self motion', () => {
  const pool = { id: 'p', minX: 0, maxX: 6, minZ: 0, maxZ: 4, baseY: 0, surfaceY: 0.4 };
  const world = (inWater: boolean, stand: boolean): MotionWorld => ({
    waterAt: () => (inWater ? pool : null),
    rideNear: () => (stand ? { vehicle: 'scooter', rackId: 'rack-1' } : null),
  });
  const input = (over: Partial<SelfMotionInput> = {}): SelfMotionInput => ({
    feet: { x: 3, y: 0, z: 2 },
    dir: { x: 0, z: 1 },
    sprint: false,
    mount: false,
    heading: 0,
    dt: 1 / 60,
    ...over,
  });

  it('walks normally on foot', () => {
    const sm = newSelfMotion();
    const out = stepSelfMotion(sm, input(), world(false, false));
    expect(sm.pose).toBeNull();
    expect(out).toEqual({ dir: { x: 0, z: 1 }, speed: null, canJump: true });
  });

  it('swims in water at a swim speed, cannot jump, and walks out at the edge', () => {
    const sm = newSelfMotion();
    const wet = stepSelfMotion(sm, input(), world(true, false));
    expect(sm.pose).toBe('swim');
    expect(wet.speed).toBe(SWIM_STRATEGIES.paddle.speed);
    expect(wet.canJump).toBe(false);
    expect(stepSelfMotion(sm, input({ sprint: true }), world(true, false)).speed).toBe(SWIM_STRATEGIES.stroke.speed);
    stepSelfMotion(sm, input(), world(false, false));
    expect(sm.pose).toBeNull();
  });

  it('does not swim while above the water', () => {
    const sm = newSelfMotion();
    stepSelfMotion(sm, input({ feet: { x: 3, y: 0.6, z: 2 } }), world(true, false));
    expect(sm.pose).toBeNull();
  });

  it('mounts next to a rack, rides, and dismounts on the same key', () => {
    const sm = newSelfMotion();
    stepSelfMotion(sm, input({ mount: true, dir: null }), world(false, false));
    expect(sm.pose).toBeNull();
    stepSelfMotion(sm, input({ mount: true, dir: null }), world(false, true));
    expect(sm.pose).toBe('scooter');
    expect(sm.rack).toBe('rack-1');
    const out = stepSelfMotion(sm, input(), world(false, false));
    expect(out.canJump).toBe(false);
    expect(out.speed).toBeGreaterThan(0);
    stepSelfMotion(sm, input({ mount: true }), world(false, false));
    expect(sm.pose).toBeNull();
    expect(sm.rack).toBeNull();
  });

  it('cannot mount while swimming', () => {
    const sm = newSelfMotion();
    stepSelfMotion(sm, input({ mount: true }), world(true, true));
    expect(sm.pose).toBe('swim');
  });

  it('drops a ride into the water as a swim and lets the vehicle go back to its rack', () => {
    const sm = newSelfMotion();
    stepSelfMotion(sm, input({ mount: true, dir: null }), world(false, true));
    stepSelfMotion(sm, input(), world(true, false));
    expect(sm.pose).toBe('swim');
    expect(sm.rack).toBeNull();
  });
});

describe('pose visuals', () => {
  it('floats a swimmer on its back at rest and turns it face down to swim', () => {
    expect(POSE_VISUALS.swim(0)).toMatchObject({ clip: 'T-Pose', floats: true });
    expect(POSE_VISUALS.swim(2.2)).toMatchObject({ clip: 'Running_B', floats: true });
    expect(POSE_VISUALS.swim(3.4).clip).toBe('Running_A');
    expect(POSE_VISUALS.swim(2.2).pitch).toBeCloseTo(PRONE_PITCH);
    expect(POSE_VISUALS.swim(0).pitch).toBeCloseTo(-PRONE_PITCH);
  });

  it('puts a rider on the vehicle, off the ground by its deck height', () => {
    expect(POSE_VISUALS.scooter(5)).toMatchObject({ vehicle: 'scooter', floats: false, lift: RIDE_STRATEGIES.scooter.deckHeight });
    expect(POSE_VISUALS.tricycle(1).vehicle).toBe('tricycle');
  });
});

describe('poke', () => {
  const poker = { x: 0, z: 0, yaw: 0 };

  it('hits the closest player in front within reach', () => {
    const others = [
      { id: 'far', x: 0, z: -3 },
      { id: 'near', x: 0, z: -1.2 },
      { id: 'closer-but-behind', x: 0, z: 0.8 },
    ];
    expect(pickPokeTarget(poker, others)).toBe('near');
  });

  it('hits nobody out of reach or behind', () => {
    expect(pickPokeTarget(poker, [{ id: 'a', x: 0, z: -(POKE_REACH_M + 0.1) }])).toBeNull();
    expect(pickPokeTarget(poker, [{ id: 'b', x: 0, z: 1 }])).toBeNull();
    expect(pickPokeTarget(poker, [])).toBeNull();
  });

  it('turns a poked player toward the poker', () => {
    const yaw = yawToward({ x: 0, z: 0 }, { x: 0, z: -5 });
    expect(yaw).toBeCloseTo(0);
    expect(pickPokeTarget({ x: 0, z: 0, yaw }, [{ id: 'a', x: 0, z: -1 }])).toBe('a');
  });
});
