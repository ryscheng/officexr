import { describe, it, expect } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import {
  proximityInnerRule,
  proximityOuterRule,
  BUBBLE_RADIUS,
} from '../../game-state/rules/proximity.ts';
import { createRuleRegistry } from '../../game-state/rules.ts';
import type { GameEvent, OfficeState, PlayerState } from '../../game-state/types.ts';
import { createInitialOfficeState } from '../../game-state/store.ts';

const OUTER_RADIUS = 6;

function player(id: string, x: number, z: number): PlayerState {
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

function buildState(opts: {
  selfId: string;
  players: Array<{ id: string; x: number; z: number }>;
  proximity?: Record<string, Set<string>>;
}): OfficeState {
  const s = createInitialOfficeState({ selfId: opts.selfId, officeId: 'r' });
  for (const p of opts.players) s.players[p.id] = player(p.id, p.x, p.z);
  if (opts.proximity) s.proximity = opts.proximity;
  return s;
}

/** Drive both proximity event-rules through a fresh RuleRegistry so the
 * per-tick collision pass produces the body-vs-{inner,outer} events that
 * the rules then translate. Mirrors the production wiring. */
function runProximityTick(state: OfficeState, prev: OfficeState) {
  const reg = createRuleRegistry();
  reg.addRule(proximityOuterRule);
  reg.addRule(proximityInnerRule);
  const bus = createBus();
  const events: GameEvent[] = [];
  bus.on('proximity:entering', (e) => events.push(e));
  bus.on('proximity:entered', (e) => events.push(e));
  bus.on('proximity:exiting', (e) => events.push(e));
  bus.on('proximity:exited', (e) => events.push(e));
  reg.tick(state, prev, bus);
  return events;
}

describe('proximity rules — four-stage hysteresis', () => {
  it('entering fires when a peer crosses INTO the outer band (not yet inner)', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 50, z: 0 },
      ],
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        // inside outer (6) but outside inner (3)
        { id: 'other', x: 4, z: 0 },
      ],
    });
    const events = runProximityTick(next, prev);
    expect(events.map((e) => e.kind)).toEqual(['proximity:entering']);
    expect((events[0] as any).otherId).toBe('other');
  });

  it('entered fires when a peer crosses INTO the inner band', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 4, z: 0 }, // already inside outer
      ],
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: BUBBLE_RADIUS - 0.1, z: 0 }, // crossed inner
      ],
    });
    const events = runProximityTick(next, prev);
    expect(events.map((e) => e.kind)).toEqual(['proximity:entered']);
  });

  it('exiting fires when a peer leaves the inner band (still in outer)', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: BUBBLE_RADIUS - 0.1, z: 0 }, // inside inner
      ],
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        // outside inner (3) but still inside outer (6)
        { id: 'other', x: 4, z: 0 },
      ],
    });
    const events = runProximityTick(next, prev);
    expect(events.map((e) => e.kind)).toEqual(['proximity:exiting']);
  });

  it('exited fires only when a peer fully clears the outer band', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 4, z: 0 }, // inside outer
      ],
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: OUTER_RADIUS + 1, z: 0 }, // crossed outer
      ],
    });
    const events = runProximityTick(next, prev);
    expect(events.map((e) => e.kind)).toEqual(['proximity:exited']);
  });

  it('handles missing self gracefully', () => {
    const prev = buildState({ selfId: 'ghost', players: [] });
    const next = buildState({ selfId: 'ghost', players: [] });
    const events = runProximityTick(next, prev);
    expect(events).toEqual([]);
  });

  it('a stationary tick with peers already in proximity emits nothing', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 1, z: 0 },
      ],
    });
    const events = runProximityTick(prev, prev);
    expect(events).toEqual([]);
  });
});
