import { describe, it, expect } from 'vitest';
import { createInitialOfficeState } from '../../game-state/store.ts';
import {
  DEFAULT_COLLISION_MATRIX,
  type CollisionMatrix,
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
  bodyShapeId,
  innerProximityShapeId,
  outerProximityShapeId,
  runCollisionPass,
} from '../../collision/index.ts';
import type { OfficeState, PlayerState } from '../../game-state/types.ts';

function p(id: string, x: number, z: number): PlayerState {
  return {
    id,
    name: id,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    isDead: false,
    avatar: { model: 'default' },
    jitsiRoom: null,
    status: 'active',
  };
}

function state(positions: Record<string, [number, number]>): OfficeState {
  const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
  for (const id in positions) {
    s.players[id] = p(id, positions[id][0], positions[id][1]);
  }
  return s;
}

describe('runCollisionPass', () => {
  it('returns no events when nothing is in contact and nothing changed', () => {
    const s = state({ a: [0, 0], b: [50, 50] });
    const events = runCollisionPass(s, s, DEFAULT_COLLISION_MATRIX);
    expect(events).toEqual([]);
  });

  it('emits collision:entered for body-vs-body on the rising edge', () => {
    const prev = state({ a: [0, 0], b: [10, 0] });   // far apart
    const next = state({ a: [0, 0], b: [0.5, 0] });  // bodies overlap (radii 0.4)
    const events = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    const bodyEntered = events.filter(
      (e) =>
        e.kind === 'collision:entered' &&
        e.a.material === CHARACTER_BODY &&
        e.b.material === CHARACTER_BODY,
    );
    expect(bodyEntered).toHaveLength(1);
    const evt = bodyEntered[0]!;
    if (evt.kind !== 'collision:entered') throw new Error('narrow');
    expect(evt.interaction).toBe('collide');
    // ids canonicalised in lexical order: a's body, b's body
    expect([evt.a.id, evt.b.id].sort()).toEqual(
      [bodyShapeId('a'), bodyShapeId('b')].sort(),
    );
    expect(evt.normal).toBeDefined();
  });

  it('emits collision:exited on the falling edge of body-vs-body', () => {
    const prev = state({ a: [0, 0], b: [0.5, 0] });
    const next = state({ a: [0, 0], b: [10, 0] });
    const events = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    const exits = events.filter(
      (e) =>
        e.kind === 'collision:exited' &&
        e.a.material === CHARACTER_BODY &&
        e.b.material === CHARACTER_BODY,
    );
    expect(exits).toHaveLength(1);
  });

  it('emits trigger events for body-vs-proximity overlap', () => {
    const prev = state({ a: [0, 0], b: [10, 0] });
    const next = state({ a: [0, 0], b: [2, 0] }); // inside both inner (3) and outer (6)
    const events = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    const triggers = events.filter(
      (e) =>
        e.kind === 'collision:entered' && e.interaction === 'trigger',
    );
    // Four trigger events: a.body × b.{inner,outer} AND b.body × a.{inner,outer}.
    expect(triggers).toHaveLength(4);
    const materialPairs = new Set(
      triggers.map((e) => [e.a.material, e.b.material].sort().join('|')),
    );
    expect(materialPairs).toEqual(
      new Set([
        `${CHARACTER_BODY}|${CHARACTER_PROXIMITY_INNER}`,
        `${CHARACTER_BODY}|${CHARACTER_PROXIMITY_OUTER}`,
      ]),
    );
  });

  it('does not emit body-vs-body when an "ignore" matrix is supplied', () => {
    const ignoreMatrix: CollisionMatrix = {
      [CHARACTER_BODY]: { [CHARACTER_BODY]: 'ignore' },
    };
    const prev = state({ a: [0, 0], b: [10, 0] });
    const next = state({ a: [0, 0], b: [0.5, 0] });
    const events = runCollisionPass(next, prev, ignoreMatrix);
    const bodyBody = events.filter(
      (e) =>
        e.a.material === CHARACTER_BODY && e.b.material === CHARACTER_BODY,
    );
    expect(bodyBody).toEqual([]);
  });

  it('emits no events when overlap state is unchanged tick to tick', () => {
    const prev = state({ a: [0, 0], b: [0.5, 0] });
    const next = state({ a: [0, 0], b: [0.5, 0] });
    const events = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    expect(events).toEqual([]);
  });

  it('produces deterministic event ordering across runs', () => {
    const prev = state({ a: [0, 0], b: [10, 0], c: [11, 0] });
    const next = state({ a: [0, 0], b: [2, 0], c: [-2, 0] });
    const e1 = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    const e2 = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    expect(e1.map((e) => `${e.kind}:${e.a.id}|${e.b.id}`)).toEqual(
      e2.map((e) => `${e.kind}:${e.a.id}|${e.b.id}`),
    );
  });

  it('an active→inactive transition fires exit events instead of entered ones', () => {
    // Prev: a and b overlap and both active.
    // Next: still positionally overlap, but b is inactive. derivePlayerShapes
    // skips inactive players, so the pass sees b vanish — that is exactly the
    // "exited" semantics we want; listeners can clean up as if b walked away.
    const prev = state({ a: [0, 0], b: [0.5, 0] });
    const next = state({ a: [0, 0], b: [0.5, 0] });
    next.players['b'].status = 'inactive';
    const events = runCollisionPass(next, prev, DEFAULT_COLLISION_MATRIX);
    const involvingB = events.filter(
      (e) => e.a.ownerId === 'b' || e.b.ownerId === 'b',
    );
    expect(involvingB.every((e) => e.kind === 'collision:exited')).toBe(true);
    expect(involvingB.length).toBeGreaterThan(0);
  });

  it('shape IDs stay stable across ticks', () => {
    expect(bodyShapeId('alice')).toBe('player:alice:body');
    expect(innerProximityShapeId('alice')).toBe('player:alice:proximity-inner');
    expect(outerProximityShapeId('alice')).toBe('player:alice:proximity-outer');
  });
});
