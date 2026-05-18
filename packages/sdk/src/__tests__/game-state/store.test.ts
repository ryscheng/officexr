import { describe, it, expect, vi } from 'vitest';
import { createStore, createInitialOfficeState } from '../../game-state/store.ts';
import type { OfficeState } from '../../game-state/types.ts';

describe('store', () => {
  it('createInitialOfficeState returns a valid empty state', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'room-1' });
    expect(s.selfId).toBe('me');
    expect(s.officeId).toBe('room-1');
    expect(s.players).toEqual({});
    expect(s.chat).toEqual([]);
    expect(s.realtime.status).toBe('connecting');
    expect(s.runtime.tickRate).toBeGreaterThan(0);
  });

  it('setState applies a partial update', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    store.setState((s) => ({
      players: {
        ...s.players,
        me: makePlayer('me'),
      },
    }));
    expect(store.getState().players.me).toBeDefined();
    expect(store.getState().players.me.id).toBe('me');
  });

  it('subscribe(selector) fires only when the selected slice changes', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const calls: number[] = [];
    store.subscribe(
      (s) => s.chat.length,
      (next) => calls.push(next),
    );
    // mutating an unrelated slice should not fire the chat subscriber
    store.setState((s) => ({
      players: { ...s.players, x: makePlayer('x') },
    }));
    expect(calls).toEqual([]);
    // mutating chat should fire it once
    store.setState((s) => ({
      chat: [...s.chat, { id: 'm1', authorId: 'me', text: 'hi', t: 0 }],
    }));
    expect(calls).toEqual([1]);
  });

  it('subscribeAll fires on every change with (state, prev)', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const seen: Array<{ next: OfficeState; prev: OfficeState }> = [];
    store.subscribeAll((next, prev) => seen.push({ next, prev }));
    store.setState((s) => ({
      chat: [...s.chat, { id: 'a', authorId: 'me', text: '1', t: 0 }],
    }));
    store.setState((s) => ({
      chat: [...s.chat, { id: 'b', authorId: 'me', text: '2', t: 1 }],
    }));
    expect(seen).toHaveLength(2);
    expect(seen[0].prev.chat).toHaveLength(0);
    expect(seen[0].next.chat).toHaveLength(1);
    expect(seen[1].prev.chat).toHaveLength(1);
    expect(seen[1].next.chat).toHaveLength(2);
  });

  it('unsubscribe stops further notifications', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const fn = vi.fn();
    const off = store.subscribeAll(fn);
    store.setState(() => ({ chat: [{ id: 'a', authorId: 'me', text: '1', t: 0 }] }));
    off();
    store.setState((s) => ({
      chat: [...s.chat, { id: 'b', authorId: 'me', text: '2', t: 1 }],
    }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscribeAll listener does not stop later listeners from firing', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const after = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.subscribeAll(() => {
      throw new Error('boom');
    });
    store.subscribeAll(after);
    store.setState((s) => ({
      chat: [...s.chat, { id: 'a', authorId: 'me', text: '1', t: 0 }],
    }));
    expect(after).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('a throwing selector subscriber does not stop other selector subscribers', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const after = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.subscribe(
      (s) => s.chat.length,
      () => {
        throw new Error('boom');
      },
    );
    store.subscribe(
      (s) => s.chat.length,
      after,
    );
    store.setState((s) => ({
      chat: [...s.chat, { id: 'a', authorId: 'me', text: '1', t: 0 }],
    }));
    expect(after).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});

describe('actions', () => {
  it('setSelfPosition updates self only', async () => {
    const { actions, store } = await makeStoreWithActions();
    seedSelf(store, 'me');
    actions.setSelfPosition({ x: 5, y: 0, z: 5 }, { x: 1, y: 0, z: 0 }, 0.5, false);
    const me = store.getState().players.me;
    expect(me.pos).toEqual({ x: 5, y: 0, z: 5 });
    expect(me.vel).toEqual({ x: 1, y: 0, z: 0 });
    expect(me.yaw).toBe(0.5);
  });

  it('applyRemotePosition sets pos+vel+yaw and writes tRecv', async () => {
    const { actions, store } = await makeStoreWithActions();
    seedPlayer(store, 'remote');
    actions.applyRemotePosition('remote', { x: 1, y: 2, z: 3 }, { x: 0.5, y: 0, z: 0 }, 1.5, 12345, false);
    const r = store.getState().players.remote;
    expect(r.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(r.vel).toEqual({ x: 0.5, y: 0, z: 0 });
    expect(r.yaw).toBe(1.5);
    expect(r.tRecv).toBe(12345);
  });

  it('appendChat pushes a message preserving order', async () => {
    const { actions, store } = await makeStoreWithActions();
    actions.appendChat({ id: 'a', authorId: 'me', text: '1', t: 0 });
    actions.appendChat({ id: 'b', authorId: 'me', text: '2', t: 1 });
    expect(store.getState().chat.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('appendStroke adds a whiteboard stroke', async () => {
    const { actions, store } = await makeStoreWithActions();
    actions.appendStroke({
      id: 's1',
      authorId: 'me',
      points: [{ x: 0, y: 0 }],
      color: '#000',
      width: 1,
      t: 0,
    });
    expect(store.getState().whiteboard.strokes).toHaveLength(1);
  });

  it('upsertPlayer adds and merges existing player fields', async () => {
    const { actions, store } = await makeStoreWithActions();
    actions.upsertPlayer({
      id: 'p',
      name: 'P',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      hp: 100,
      isDead: false,
      isAirborne: false,
      avatar: { model: 'default' },
      jitsiRoom: null,
      status: 'active',
    });
    actions.upsertPlayer({ id: 'p', hp: 50 });
    const p = store.getState().players.p;
    expect(p.hp).toBe(50);
    expect(p.name).toBe('P');
  });

  it('removePlayer deletes a player entry', async () => {
    const { actions, store } = await makeStoreWithActions();
    seedPlayer(store, 'gone');
    actions.removePlayer('gone');
    expect(store.getState().players.gone).toBeUndefined();
  });

  it('setMyJitsiRoom updates self.jitsiRoom', async () => {
    const { actions, store } = await makeStoreWithActions();
    seedSelf(store, 'me');
    actions.setMyJitsiRoom('room-abc');
    expect(store.getState().players.me.jitsiRoom).toBe('room-abc');
  });
});

// helpers ----------------------------------------------------------

function makePlayer(id: string) {
  return {
    id,
    name: id,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    isDead: false,
    isAirborne: false,
    avatar: { model: 'default' },
    jitsiRoom: null,
    status: 'active' as const,
  };
}

function seedSelf(store: ReturnType<typeof createStore>, id: string) {
  store.setState((s) => ({
    selfId: id,
    players: { ...s.players, [id]: makePlayer(id) },
  }));
}

function seedPlayer(store: ReturnType<typeof createStore>, id: string) {
  store.setState((s) => ({
    players: { ...s.players, [id]: makePlayer(id) },
  }));
}

async function makeStoreWithActions() {
  const { createActions } = await import('../../game-state/actions.ts');
  const store = createStore({ selfId: 'me', officeId: 'r' });
  const actions = createActions(store);
  return { store, actions };
}
