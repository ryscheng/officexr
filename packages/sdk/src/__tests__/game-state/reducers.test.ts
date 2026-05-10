import { describe, it, expect } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import { createStore } from '../../game-state/store.ts';
import { attachProximityReducer } from '../../game-state/reducers/proximity.ts';

describe('proximity reducer', () => {
  it('proximity:entered adds otherId to self set', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    bus.emit({ kind: 'proximity:entered', otherId: 'other' });
    expect(store.getState().proximity.me).toBeInstanceOf(Set);
    expect(store.getState().proximity.me.has('other')).toBe(true);
  });

  it('proximity:exited removes otherId from self set', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    bus.emit({ kind: 'proximity:entered', otherId: 'a' });
    bus.emit({ kind: 'proximity:entered', otherId: 'b' });
    bus.emit({ kind: 'proximity:exited', otherId: 'a' });
    const set = store.getState().proximity.me;
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
  });

  it('hysteresis: entering/exiting do not mutate the proximity set', () => {
    // The visual approach band is intentionally NOT tracked here — only
    // entered (inner-IN) and exited (outer-OUT) drive membership.
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    bus.emit({ kind: 'proximity:entering', otherId: 'x' });
    expect(store.getState().proximity.me?.has('x') ?? false).toBe(false);
    bus.emit({ kind: 'proximity:entered', otherId: 'x' });
    expect(store.getState().proximity.me.has('x')).toBe(true);
    bus.emit({ kind: 'proximity:exiting', otherId: 'x' });
    // still in voice — wider berth
    expect(store.getState().proximity.me.has('x')).toBe(true);
    bus.emit({ kind: 'proximity:exited', otherId: 'x' });
    expect(store.getState().proximity.me.has('x')).toBe(false);
  });
});
