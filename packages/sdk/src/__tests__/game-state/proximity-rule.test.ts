import { describe, it, expect } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import { proximityRule, BUBBLE_RADIUS } from '../../game-state/rules/proximity.ts';
import type { GameEvent, OfficeState, PlayerState } from '../../game-state/types.ts';
import { createInitialOfficeState } from '../../game-state/store.ts';

function player(id: string, x: number, z: number, prox: string[] = []): PlayerState {
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

function captureEmissions(): { bus: ReturnType<typeof createBus>; events: GameEvent[] } {
  const bus = createBus();
  const events: GameEvent[] = [];
  bus.on('proximity:entering', (e) => events.push(e));
  bus.on('proximity:entered', (e) => events.push(e));
  bus.on('proximity:exiting', (e) => events.push(e));
  bus.on('proximity:exited', (e) => events.push(e));
  return { bus, events };
}

describe('proximityRule', () => {
  it('emits proximity:entering when another player enters bubble for the first time', () => {
    const prev = buildState({ selfId: 'me', players: [{ id: 'me', x: 0, z: 0 }] });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: BUBBLE_RADIUS - 0.1, z: 0 },
      ],
    });
    const { bus, events } = captureEmissions();
    proximityRule(next, prev, bus);
    expect(events).toEqual([{ kind: 'proximity:entering', otherId: 'other' }]);
  });

  it('emits proximity:entered for already-in-bubble peers (steady-state)', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 1, z: 0 },
      ],
      proximity: { me: new Set(['other']) },
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 1.1, z: 0 },
      ],
      proximity: { me: new Set(['other']) },
    });
    const { bus, events } = captureEmissions();
    proximityRule(next, prev, bus);
    expect(events).toEqual([{ kind: 'proximity:entered', otherId: 'other' }]);
  });

  it('emits proximity:exiting when a peer leaves the bubble', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: BUBBLE_RADIUS - 0.1, z: 0 },
      ],
      proximity: { me: new Set(['other']) },
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: BUBBLE_RADIUS + 1, z: 0 },
      ],
      proximity: { me: new Set(['other']) },
    });
    const { bus, events } = captureEmissions();
    proximityRule(next, prev, bus);
    expect(events).toEqual([{ kind: 'proximity:exiting', otherId: 'other' }]);
  });

  it('handles missing self gracefully', () => {
    const prev = buildState({ selfId: 'ghost', players: [] });
    const next = buildState({ selfId: 'ghost', players: [] });
    const { bus, events } = captureEmissions();
    proximityRule(next, prev, bus);
    expect(events).toEqual([]);
  });

  it('emits independent enter+entered events for multi-peer scenarios', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'a', x: 1, z: 0 },
      ],
      proximity: { me: new Set(['a']) },
    });
    const next = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'a', x: 1.5, z: 0 },
        { id: 'b', x: 0, z: 1.5 },
      ],
      proximity: { me: new Set(['a']) },
    });
    const { bus, events } = captureEmissions();
    proximityRule(next, prev, bus);
    const kinds = events.map((e) => `${e.kind}:${(e as any).otherId}`);
    expect(kinds.sort()).toEqual(['proximity:entered:a', 'proximity:entering:b']);
  });

  it('a stationary tick with no membership changes emits only entered events', () => {
    const prev = buildState({
      selfId: 'me',
      players: [
        { id: 'me', x: 0, z: 0 },
        { id: 'other', x: 1, z: 0 },
      ],
      proximity: { me: new Set(['other']) },
    });
    const { bus, events } = captureEmissions();
    proximityRule(prev, prev, bus);
    expect(events.map((e) => e.kind)).toEqual(['proximity:entered']);
  });
});
