import { describe, it, expect } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';

describe('applyRemotePosition — membership upsert', () => {
  it('creates a default-shape player when none exists for the actor', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);

    expect(store.getState().players['stranger']).toBeUndefined();

    actions.applyRemotePosition(
      'stranger',
      { x: 1, y: 2, z: 3 },
      { x: 0.5, y: 0, z: -0.5 },
      Math.PI / 4,
      1234,
      false,
    );

    const created = store.getState().players['stranger'];
    expect(created).toBeDefined();
    expect(created.id).toBe('stranger');
    expect(created.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(created.vel).toEqual({ x: 0.5, y: 0, z: -0.5 });
    expect(created.yaw).toBeCloseTo(Math.PI / 4);
    expect(created.tRecv).toBe(1234);
    // sensible defaults for fields that aren't on the wire
    expect(created.hp).toBe(100);
    expect(created.isDead).toBe(false);
    expect(created.status).toBe('active');
    expect(created.avatar).toEqual({ model: 'default' });
  });

  it('patches an existing player without overwriting non-position fields', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.upsertPlayer({
      id: 'alice',
      name: 'Alice',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      hp: 73,
      avatar: { model: 'rogue', colors: { primary: '#abc' } },
    });

    actions.applyRemotePosition(
      'alice',
      { x: 9, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      0,
      9999,
      false,
    );

    const after = store.getState().players['alice'];
    expect(after.pos).toEqual({ x: 9, y: 0, z: 0 });
    expect(after.tRecv).toBe(9999);
    // unchanged
    expect(after.name).toBe('Alice');
    expect(after.hp).toBe(73);
    expect(after.avatar).toEqual({ model: 'rogue', colors: { primary: '#abc' } });
  });
});
