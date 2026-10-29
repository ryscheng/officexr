import { describe, it, expect } from 'vitest';
import { PROTOCOL, validateNetEvent } from '../../realtime/protocol.ts';
import { createInitialOfficeState, createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { applySnapshot, serializeOfficeState } from '../../game-state/snapshot.ts';
import type { WorldObjects } from '../../game-state/types.ts';

const objects: WorldObjects = {
  cubeSize: 0.5,
  instances: [
    { id: 'a', sourceCommandId: 'a', kindId: 'wall', position: [0, 0, 0], yawDeg: 90 },
    { id: 'b', sourceCommandId: 'b', kindId: 'wall', position: [4, 0, 0] },
  ],
};

const worldObjectsEvent = (objs: unknown) => ({
  kind: 'world:objects',
  v: 1,
  actorId: 'a',
  seq: 1,
  t: 0,
  objects: objs,
});

describe('ObjectInstance.yawDeg', () => {
  it('survives the world:objects schema', () => {
    const parsed = PROTOCOL['world:objects'].schema.parse(worldObjectsEvent(objects)) as {
      objects: WorldObjects;
    };
    expect(parsed.objects).toEqual(objects);
  });

  it('rejects a non-numeric yawDeg', () => {
    const bad = { ...objects, instances: [{ ...objects.instances[0], yawDeg: '90' }] };
    expect(validateNetEvent(worldObjectsEvent(bad)).ok).toBe(false);
  });

  it('survives setWorldObjects and applyRemoteWorldObjects', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.setWorldObjects(objects);
    expect(store.getState().worldObjects).toEqual(objects);
    actions.setWorldObjects({ cubeSize: 0.5, instances: [] });
    actions.applyRemoteWorldObjects(objects);
    expect(store.getState().worldObjects).toEqual(objects);
  });

  it('survives a snapshot round-trip', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    s.worldObjects = objects;
    const restored = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    applySnapshot(restored, JSON.parse(JSON.stringify(serializeOfficeState(s))), 0);
    expect(restored.worldObjects).toEqual(objects);
  });
});
