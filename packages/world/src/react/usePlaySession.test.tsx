// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createActions, createStore } from '@officexr/sdk';
import { createDefaultApi } from '../app/create-default-api.ts';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
} from '../scenes/index.ts';
import { ApplicationProvider } from './application-context.tsx';
import { usePlaySession, type UsePlaySessionOptions } from './usePlaySession.ts';

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
  bakedMap.rooms = [{ id: 'b', roomName: 'baked-room', position: [4, 0, -2], rotationY: 3 }];
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
  return { actions, onMapApplied, render };
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
    const { render } = setup();
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    const { result, rerender } = render('office', { actions });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(store.getState().voiceZones.map((z) => z.id)).toEqual(['a']);

    rerender({ actions, mapName: 'baked' });
    await waitFor(() => expect(store.getState().voiceZones).toEqual([]));
  });

  it('passes the baked layout and its placement through', async () => {
    const { render } = setup();
    const { result } = render('baked');

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.bakedLayoutName).toBe('hall');
    expect(result.current.bakedPlacement).toMatchObject({ position: [4, 0, -2], rotationY: 3 });
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
