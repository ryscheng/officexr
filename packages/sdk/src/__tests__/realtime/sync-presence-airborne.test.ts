import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { PositionBroadcaster } from '../../realtime/outbound/position-broadcaster.ts';
import type { NetEvent } from '../../realtime/protocol.ts';
import { DEFAULT_WORLD_SETTINGS } from '../../game-state/types.ts';

function makeClock(ms = 1000) {
  return { now: () => ms };
}

function makeStore(selfId = 'me') {
  const store = createStore({ selfId, officeId: 'r' });
  return store;
}

describe('applyRemotePosition stores isAirborne', () => {
  it('stores isAirborne: true for a remote peer', () => {
    const store = makeStore();
    const actions = createActions(store);
    const pos = { x: 1, y: 0, z: 1 };
    const vel = { x: 0, y: 0, z: 0 };

    actions.applyRemotePosition('peer', pos, vel, 0, Date.now(), true);

    expect(store.getState().players['peer']?.isAirborne).toBe(true);
  });

  it('stores isAirborne: false for a remote peer', () => {
    const store = makeStore();
    const actions = createActions(store);
    const pos = { x: 1, y: 0, z: 1 };
    const vel = { x: 0, y: 0, z: 0 };

    actions.applyRemotePosition('peer', pos, vel, 0, Date.now(), false);

    expect(store.getState().players['peer']?.isAirborne).toBe(false);
  });

  it('updates isAirborne from false to true on a subsequent call', () => {
    const store = makeStore();
    const actions = createActions(store);
    const pos = { x: 1, y: 0, z: 1 };
    const vel = { x: 0, y: 0, z: 0 };

    actions.applyRemotePosition('peer', pos, vel, 0, 0, false);
    expect(store.getState().players['peer']?.isAirborne).toBe(false);

    actions.applyRemotePosition('peer', pos, vel, 0, 1, true);
    expect(store.getState().players['peer']?.isAirborne).toBe(true);
  });
});

describe('setSelfPosition stores isAirborne', () => {
  it('stores isAirborne: true for self', () => {
    const store = makeStore('player1');
    const actions = createActions(store);
    // Upsert self so patchSelf can find the player
    actions.upsertPlayer({ id: 'player1', name: 'Alice' });
    const pos = { x: 0, y: 2, z: 0 };
    const vel = { x: 0, y: 5, z: 0 };

    actions.setSelfPosition(pos, vel, 0, true);

    expect(store.getState().players['player1']?.isAirborne).toBe(true);
  });

  it('stores isAirborne: false for self', () => {
    const store = makeStore('player1');
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'player1', name: 'Alice' });
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 1, y: 0, z: 0 };

    actions.setSelfPosition(pos, vel, 0, false);

    expect(store.getState().players['player1']?.isAirborne).toBe(false);
  });
});

describe('PositionBroadcaster includes isAirborne in emitted events', () => {
  it('announceSelf emits isAirborne: false (initial spawn)', () => {
    const store = makeStore('me');
    const clock = makeClock();
    const captured: NetEvent[] = [];
    const broadcast = vi.fn((e: NetEvent) => captured.push(e));
    let seq = 0;
    const takeSeq = () => ++seq;

    // Upsert self so announceSelf can find the player
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'me', name: 'Me', isAirborne: false });

    const broadcaster = new PositionBroadcaster({ store, clock, broadcast, takeSeq });
    broadcaster.announceSelf();

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('presence:position');
    expect((captured[0] as Extract<NetEvent, { kind: 'presence:position' }>).isAirborne).toBe(false);
  });

  it('announceSelf emits isAirborne: true when player is airborne', () => {
    const store = makeStore('me');
    const clock = makeClock();
    const captured: NetEvent[] = [];
    const broadcast = vi.fn((e: NetEvent) => captured.push(e));
    let seq = 0;
    const takeSeq = () => ++seq;

    const actions = createActions(store);
    actions.upsertPlayer({ id: 'me', name: 'Me', isAirborne: true });

    const broadcaster = new PositionBroadcaster({ store, clock, broadcast, takeSeq });
    broadcaster.announceSelf();

    expect(captured).toHaveLength(1);
    expect((captured[0] as Extract<NetEvent, { kind: 'presence:position' }>).isAirborne).toBe(true);
  });

  it('flushPosition emits isAirborne from player state', () => {
    const store = makeStore('me');
    const clock = { now: vi.fn(() => 0) };
    const captured: NetEvent[] = [];
    const broadcast = vi.fn((e: NetEvent) => captured.push(e));
    let seq = 0;
    const takeSeq = () => ++seq;

    const actions = createActions(store);
    actions.upsertPlayer({
      id: 'me',
      name: 'Me',
      pos: { x: 0, y: 0, z: 0 },
      isAirborne: false,
    });

    const broadcaster = new PositionBroadcaster({ store, clock, broadcast, takeSeq });

    // Advance to a position far enough from initial to trigger broadcast
    clock.now.mockReturnValue(1000);
    actions.setSelfPosition({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, true);
    broadcaster.flushPosition();

    // The first call sets the baseline without sending; we need to move and flush again
    // Actually: on first call it just sets baseline if !hasInitialPosition.
    // Call again after more movement to get a real send:
    clock.now.mockReturnValue(2000);
    actions.setSelfPosition({ x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, true);
    broadcaster.flushPosition();

    const posEvents = captured.filter((e) => e.kind === 'presence:position') as Array<
      Extract<NetEvent, { kind: 'presence:position' }>
    >;
    expect(posEvents.length).toBeGreaterThan(0);
    expect(posEvents[posEvents.length - 1].isAirborne).toBe(true);
  });
});

// Silence unused import
void DEFAULT_WORLD_SETTINGS;
