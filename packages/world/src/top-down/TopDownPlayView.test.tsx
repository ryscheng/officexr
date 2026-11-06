// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { GhostController } from '../app/ghost-controller.ts';
import { createDefaultApi } from '../app/create-default-api.ts';
import { ApplicationProvider } from '../react/application-context.tsx';
import { usePlayControls } from '../react/playControls.tsx';
import { useNavGrid } from '../react/useNavGrid.ts';
import { focusWorld } from '../react/useWorldFocus.ts';
import { useViewYaw } from '../react/viewYaw.tsx';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
} from '../scenes/index.ts';
import { PLAYER_RADIUS_PX } from './topDownDraw.ts';
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

async function mount(opts: { onPingPlayer?: (id: string) => void; ctx?: object } = {}) {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  getContext.mockImplementation((() => opts.ctx ?? null) as typeof HTMLCanvasElement.prototype.getContext);
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
        onPingPlayer={opts.onPingPlayer}
      >
        <Hud />
      </TopDownPlayView>
    </ApplicationProvider>,
  );
  const released = () =>
    waitFor(() => {
      harness.flush();
      expect(bob.store.getState().players.alice).toBeDefined();
    });
  return { getContext, alice, bob, released };
}

describe('TopDownPlayView', () => {
  it('renders children that use the play-control, view-yaw and nav-grid contexts', async () => {
    await mount();
    expect(screen.getByTestId('hud').textContent).toBe('idle 0');
  });

  it('moves the local player in the store on a key press', async () => {
    const { alice, released } = await mount();
    await released();
    const startZ = alice.store.getState().players.alice!.pos.z;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await waitFor(() => expect(alice.store.getState().players.alice!.pos.z).toBeLessThan(startZ - 0.05));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  });

  it('ignores movement keys once focus moves into a panel, until the world is refocused', async () => {
    const { alice, released } = await mount();
    await released();
    const z = () => alice.store.getState().players.alice!.pos.z;
    const startZ = z();
    render(<aside data-studio-panel="true"><button>in panel</button></aside>);
    fireEvent.mouseDown(screen.getByText('in panel'));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(z()).toBe(startZ);

    act(() => focusWorld());
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await waitFor(() => expect(z()).toBeLessThan(startZ - 0.05));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  });

  it('lets a peer on the same hub see the local player after releaseSelf', async () => {
    const { bob, released } = await mount();
    expect(bob.store.getState().players.alice).toBeUndefined();
    await released();
  });

  it('only ever asks the canvas for a 2d context', async () => {
    const { getContext, released } = await mount();
    await released();
    await waitFor(() => expect(getContext).toHaveBeenCalled());
    expect(getContext.mock.calls.every(([kind]) => (kind as string) === '2d')).toBe(true);
  });

  describe('ping bell', () => {
    /** A 2D context that no-ops every call and records the centre of each player marker. */
    function recordingContext() {
      const markers = new Map<string, { x: number; y: number }>();
      const ctx = new Proxy(
        {},
        {
          get: (_, prop) =>
            prop === 'arc'
              ? (x: number, y: number, r: number) => r === PLAYER_RADIUS_PX && markers.set(`${x},${y}`, { x, y })
              : () => {},
          set: () => true,
        },
      );
      return { ctx, markers };
    }

    /** Moves over each marker until a bell shows; self markers never show one. */
    async function hoverMarkers(onPingPlayer?: (id: string) => void) {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
      const { ctx, markers } = recordingContext();
      const view = await mount({ onPingPlayer, ctx });
      await view.released();
      await waitFor(() => expect(markers.size).toBe(2));
      const canvas = document.querySelector('canvas')!;
      for (const { x, y } of markers.values()) {
        fireEvent.mouseMove(canvas, { clientX: x, clientY: y });
        if (screen.queryByRole('button')) {
          break;
        }
      }
      return { canvas };
    }

    it('shows a bell over a hovered player; clicking it pings without moving', async () => {
      const moveTo = vi.spyOn(GhostController.prototype, 'moveTo');
      const onPingPlayer = vi.fn();
      await hoverMarkers(onPingPlayer);
      fireEvent.click(await screen.findByRole('button', { name: 'Ping player' }));
      expect(onPingPlayer).toHaveBeenCalledWith('bob');
      expect(moveTo).not.toHaveBeenCalled();
    });

    it('moves when the canvas is clicked elsewhere', async () => {
      const moveTo = vi.spyOn(GhostController.prototype, 'moveTo');
      const { canvas } = await hoverMarkers(vi.fn());
      fireEvent.click(canvas, { clientX: 1, clientY: 1 });
      expect(moveTo).toHaveBeenCalled();
    });

    it('shows no bell without onPingPlayer', async () => {
      await hoverMarkers();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
