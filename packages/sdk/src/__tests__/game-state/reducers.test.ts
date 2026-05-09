import { describe, it, expect } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import { createStore } from '../../game-state/store.ts';
import { attachProximityReducer } from '../../game-state/reducers/proximity.ts';

describe('proximity reducer', () => {
  it('proximity:entering adds otherId to self set', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    bus.emit({ kind: 'proximity:entering', otherId: 'other' });
    expect(store.getState().proximity.me).toBeInstanceOf(Set);
    expect(store.getState().proximity.me.has('other')).toBe(true);
  });

  it('proximity:exiting removes otherId from self set', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    bus.emit({ kind: 'proximity:entering', otherId: 'a' });
    bus.emit({ kind: 'proximity:entering', otherId: 'b' });
    bus.emit({ kind: 'proximity:exiting', otherId: 'a' });
    const set = store.getState().proximity.me;
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
  });

  it('emits proximity:exited after the set has been updated', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    const exited: string[] = [];
    bus.on('proximity:exited', (e) => exited.push(e.otherId));
    bus.emit({ kind: 'proximity:entering', otherId: 'x' });
    bus.emit({ kind: 'proximity:exiting', otherId: 'x' });
    expect(exited).toEqual(['x']);
    expect(store.getState().proximity.me?.has('x')).toBe(false);
  });
});
