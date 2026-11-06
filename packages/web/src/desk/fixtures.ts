import { createActions, createBus, createStore } from '@officexr/sdk';

export const ME = 'me@example.com';
const AREA = { id: 'd1', label: 'Desk', min: { x: 0, z: 0 }, max: { x: 4, z: 4 }, seatInstanceId: 'chair' };

/** A store with the self player `ME` at `pos` and one desk area `d1` spanning (0,0)-(4,4). */
export function deskWorld(pos = { x: 2, y: 0, z: 2 }) {
  const store = createStore({ selfId: ME, officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: ME, name: 'Me', pos });
  actions.setDeskAreas([AREA]);
  const move = (p: { x: number; y?: number; z: number }) => actions.setSelfPosition({ y: 0, ...p }, { x: 0, y: 0, z: 0 }, 0, false);
  return { store, actions, move };
}
