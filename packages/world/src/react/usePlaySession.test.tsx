// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createActions, createStore } from '@officexr/sdk';
import { createDefaultApi } from '../app/create-default-api.ts';
import { computeVoiceZones } from '../app/voice-zones.ts';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  emptyMapDocument,
  emptyRoomDocument,
  type MapDocumentV2,
  type RoomDocument,
  newPlaceObject,
} from '../scenes/index.ts';
import { ApplicationProvider } from './application-context.tsx';
import { usePlaySession, type UsePlaySessionOptions } from './usePlaySession.ts';
import { INITIAL_WORLD_READINESS, worldReadiness, type WorldReadinessEvent } from './world-readiness.ts';

afterEach(() => {
  cleanup();
});

function setup() {
  const api = createDefaultApi({ fetcher: async () => new Response('{}', { status: 404 }) });
  const room = emptyRoomDocument('room');
  room.commands.push(newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }));
  const map = emptyMapDocument('office');
  map.rooms = [{ id: 'a', roomName: 'room', position: [0, 0, 0], voiceZone: true }];
  map.spawnPoints = [{ id: 's', position: [1, 2, 3] }];
  const bakedRoom = emptyRoomDocument('baked-room');
  bakedRoom.layoutName = 'hall';
  const bakedMap = emptyMapDocument('baked');
  const annexRoom = emptyRoomDocument('annex-room');
  annexRoom.commands.push(newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }));
  annexRoom.layoutName = 'annex';
  bakedMap.rooms = [
    { id: 'b', roomName: 'baked-room', position: [4, 0, -2], rotationY: 3 },
    { id: 'c', roomName: 'baked-room', position: [40, 0, 0] },
    { id: 'd', roomName: 'annex-room', position: [0, 0, 40] },
  ];
  const storages = {
    maps: new InMemoryMapStorage({
      seed: [
        { name: 'office', doc: map },
        { name: 'baked', doc: bakedMap },
      ],
    }),
    rooms: new InMemoryRoomStorage({
      seed: [
        { name: 'room', doc: room },
        { name: 'baked-room', doc: bakedRoom },
        { name: 'annex-room', doc: annexRoom },
      ],
    }),
    layouts: new InMemoryLayoutStorage(),
  };
  const actions = {
    setWorldObjects: vi.fn(),
    setVoiceZones: vi.fn(),
    setSelfPosition: vi.fn(),
  };
  const onMapApplied = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ApplicationProvider api={api}>{children}</ApplicationProvider>
  );
  const render = (mapName: string, initial: Partial<UsePlaySessionOptions> = {}) =>
    renderHook(
      (opts: Partial<UsePlaySessionOptions>) =>
        usePlaySession({
          actions,
          mapName,
          storages,
          onMapApplied,
          ...opts,
        }),
      { wrapper, initialProps: initial },
    );
  return { api, actions, onMapApplied, render, storages };
}

describe('usePlaySession', () => {
  it('pushes world objects, places the player just above the first spawn and reports spawn points', async () => {
    const { actions, onMapApplied, render } = setup();
    const { result } = render('office');

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(actions.setWorldObjects).toHaveBeenCalledOnce();
    expect(actions.setWorldObjects.mock.calls[0][0].instances).toHaveLength(1);
    expect(actions.setSelfPosition).toHaveBeenCalledWith({ x: 1, y: 2.1, z: 3 }, { x: 0, y: 0, z: 0 }, 0, false);
    expect(onMapApplied).toHaveBeenCalledWith([{ x: 1, y: 2, z: 3 }]);
    expect(result.current.spawnPoints).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(result.current.error).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(result.current.failed).toBe(false);
  });

  it('puts the map\'s voice zones in the store, none for a map without any', async () => {
    const { api, render, storages } = setup();
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    const { result, rerender } = render('office', { actions });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const zones = store.getState().voiceZones;
    expect(zones.map((z) => z.id)).toEqual(['a']);
    expect(zones).toEqual(
      computeVoiceZones(
        (await storages.maps.load('office'))! as MapDocumentV2,
        new Map([['room', await storages.rooms.load('room') as RoomDocument]]),
        new Map(),
        api.rooms,
        api.geometry,
      ),
    );

    rerender({ actions, mapName: 'baked' });
    await waitFor(() => expect(store.getState().voiceZones).toEqual([]));
  });

  it('passes every layout placement through with its GLB url', async () => {
    const { render } = setup();
    const { result } = render('baked');

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.bakedLayouts).toEqual([
      { roomInstanceId: 'b', layoutName: 'hall', position: [4, 0, -2], rotationY: 3, gltfPath: '/api/baked-layouts/hall' },
      { roomInstanceId: 'c', layoutName: 'hall', position: [40, 0, 0], rotationY: 0, gltfPath: '/api/baked-layouts/hall' },
      { roomInstanceId: 'd', layoutName: 'annex', position: [0, 0, 40], rotationY: 0, gltfPath: '/api/baked-layouts/annex' },
    ]);
  });

  it("holds world readiness until every placement's colliders mount, and fails if any fails", async () => {
    const { render } = setup();
    const { result } = render('baked');
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const applied: WorldReadinessEvent[] = [
      { type: 'mapApplied', bakedLayouts: result.current.bakedLayouts },
      { type: 'modelsReady' },
    ];
    const collidersReady = (roomInstanceId: string): WorldReadinessEvent => ({ type: 'collidersReady', roomInstanceId });
    const run = (events: WorldReadinessEvent[]) => events.reduce(worldReadiness, INITIAL_WORLD_READINESS);

    expect(run([...applied, collidersReady('b'), collidersReady('d')]).type).toBe('loading');
    expect(run([...applied, collidersReady('b'), collidersReady('d'), collidersReady('c')])).toEqual({ type: 'ready' });
    expect(
      run([...applied, collidersReady('b'), collidersReady('c'), { type: 'collidersFailed', message: '404' }]),
    ).toEqual({ type: 'failed', message: '404' });
  });

  it('re-applies the map when reloadKey changes', async () => {
    const { actions, render } = setup();
    const { result, rerender } = render('office');
    await waitFor(() => expect(result.current.ready).toBe(true));

    rerender({ reloadKey: 1 });

    await waitFor(() => expect(actions.setSelfPosition).toHaveBeenCalledTimes(2));
    expect(actions.setWorldObjects).toHaveBeenCalledTimes(2);
  });

  it('surfaces a load error and keeps the previous map applied', async () => {
    const { actions, onMapApplied, render } = setup();
    const { result, rerender } = render('office');
    await waitFor(() => expect(result.current.ready).toBe(true));

    rerender({ mapName: 'missing' });

    await waitFor(() => expect(result.current.error).toMatch(/missing/));
    expect(result.current.ready).toBe(true);
    expect(result.current.loaded).toBe(true);
    expect(result.current.failed).toBe(false);
    expect(result.current.spawnPoints).toEqual([{ x: 1, y: 2, z: 3 }]);
    expect(actions.setWorldObjects).toHaveBeenCalledOnce();
    expect(onMapApplied).toHaveBeenCalledOnce();
  });

  it('settles a failed first load as failed, with the error set', async () => {
    const { actions, onMapApplied, render } = setup();
    const { result } = render('missing');

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toMatch(/missing/);
    expect(result.current.loaded).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(result.current.spawnPoints).toEqual([]);
    expect(actions.setWorldObjects).not.toHaveBeenCalled();
    expect(onMapApplied).not.toHaveBeenCalled();
  });
});
