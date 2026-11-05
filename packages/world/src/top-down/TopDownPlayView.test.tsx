// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { createDefaultApi } from '../app/create-default-api.ts';
import { ApplicationProvider } from '../react/application-context.tsx';
import { usePlayControls } from '../react/playControls.tsx';
import { useNavGrid } from '../react/useNavGrid.ts';
import { useViewYaw } from '../react/viewYaw.tsx';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
} from '../scenes/index.ts';
import { TopDownPlayView } from './TopDownPlayView.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function storages() {
  const room = emptyRoomDocument('room');
  room.commands.push(newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }));
  const map = emptyMapDocument('office');
  map.rooms = [{ id: 'a', roomName: 'room', position: [0, 0, 0] }];
  map.spawnPoints = [{ id: 's', position: [5, 0, 5] }];
  return {
    maps: new InMemoryMapStorage({ seed: [{ name: 'office', doc: map }] }),
    rooms: new InMemoryRoomStorage({ seed: [{ name: 'room', doc: room }] }),
    layouts: new InMemoryLayoutStorage(),
  };
}

function Hud() {
  const { state } = usePlayControls();
  const yaw = useViewYaw();
  useNavGrid();
  return <div data-testid="hud">{`${state.type} ${yaw}`}</div>;
}

describe('TopDownPlayView', () => {
  it('provides the HUD contexts, moves the ghost on keys and announces it to peers, with only a 2d context', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice', { holdSelf: true });
    const bob = await harness.add('bob');
    const api = createDefaultApi({ fetcher: async () => new Response('{}', { status: 404 }) });

    render(
      <ApplicationProvider api={api}>
        <TopDownPlayView
          store={alice.store}
          actions={alice.actions}
          rules={alice.rules}
          bus={alice.bus}
          sync={alice.sync}
          handshake={alice.handshake}
          selfId="alice"
          mapName="office"
          storages={storages()}
        >
          <Hud />
        </TopDownPlayView>
      </ApplicationProvider>,
    );
    expect(screen.getByTestId('hud').textContent).toBe('idle 0');

    await waitFor(() => {
      harness.flush();
      expect(bob.store.getState().players.alice).toBeDefined();
    });

    const startZ = alice.store.getState().players.alice!.pos.z;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await waitFor(() => expect(alice.store.getState().players.alice!.pos.z).toBeLessThan(startZ - 0.05));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));

    expect(getContext).toHaveBeenCalled();
    expect(getContext.mock.calls.every(([kind]) => (kind as string) === '2d')).toBe(true);
  });
});
