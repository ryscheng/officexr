import { describe, expect, it } from 'vitest';
import { createActions, createBus, createStore, MAX_PLACED_PROPS, type PropOp } from '@officexr/sdk';
import { createPreviewPropOps } from './previewPropOps';

const setup = () => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  return { store, request: createPreviewPropOps(store, actions) };
};
const place: PropOp = { op: 'place', kindId: 'prop_pool', position: [1, 0, 2], yawDeg: 0 };

describe('createPreviewPropOps', () => {
  it('adds a placed prop with a new id, then removes it', async () => {
    const { store, request } = setup();
    await expect(request(place)).resolves.toEqual({ ok: true });
    const [prop] = store.getState().placedProps;
    expect(prop).toMatchObject({ kindId: 'prop_pool', position: [1, 0, 2], yawDeg: 0 });
    await expect(request({ op: 'remove', id: prop!.id })).resolves.toEqual({ ok: true });
    expect(store.getState().placedProps).toEqual([]);
    await expect(request({ op: 'remove', id: prop!.id })).resolves.toMatchObject({ ok: false, error: 'not-found' });
  });

  it('refuses a placement past the limit', async () => {
    const { store, request } = setup();
    for (let i = 0; i < MAX_PLACED_PROPS; i++) {
      await request(place);
    }
    await expect(request(place)).resolves.toMatchObject({ ok: false, error: 'limit' });
    expect(store.getState().placedProps).toHaveLength(MAX_PLACED_PROPS);
  });
});
