import { createActions, createBus, createStore } from '@officexr/sdk';
import { describe, expect, it } from 'vitest';
import { selectSomeoneNear } from './someoneNear';

const setup = (peers: { id: string; name: string; x: number }[]) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  for (const p of peers) {
    actions.upsertPlayer({ id: p.id, name: p.name, pos: { x: p.x, y: 0, z: 0 } });
  }
  return store;
};

describe('selectSomeoneNear', () => {
  it('is true for a named person within 8 m', () => {
    expect(selectSomeoneNear(setup([{ id: 'a', name: 'Ana', x: 7 }]).getState())).toBe(true);
  });

  it('is false when everyone is further away or has no name yet', () => {
    expect(selectSomeoneNear(setup([{ id: 'a', name: 'Ana', x: 30 }, { id: 'b', name: ' ', x: 1 }]).getState())).toBe(false);
  });
});
