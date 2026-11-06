// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { createDefaultApi } from '../app/create-default-api.ts';
import { ApplicationProvider } from './application-context.tsx';
import { InMemoryLayoutStorage, InMemoryMapStorage, InMemoryRoomStorage } from '../scenes/index.ts';
import { PlayView, type PlayViewProps } from './PlayView.tsx';

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

/** An unknown map name fails to load, so `<Scene>` (WebGL) never mounts but the HUD does. */
async function mount(hud?: PlayViewProps['hud']) {
  const harness = createMultiClientHarness();
  const alice = await harness.add('alice', { holdSelf: true });
  const api = createDefaultApi({
    fetcher: async () => new Response('{}', { status: 404 }),
  });
  render(
    <ApplicationProvider api={api}>
      <PlayView
        store={alice.store}
        actions={alice.actions}
        rules={alice.rules}
        bus={alice.bus}
        sync={alice.sync}
        handshake={alice.handshake}
        selfId="alice"
        mapName="missing"
        realtime="ws"
        hud={hud}
        storages={{
          maps: new InMemoryMapStorage(),
          rooms: new InMemoryRoomStorage(),
          layouts: new InMemoryLayoutStorage(),
        }}
      />
    </ApplicationProvider>,
  );
}

describe('PlayView hud', () => {
  it('shows the debug status line by default', async () => {
    await mount();
    expect(screen.getByText(/Camera:.*Realtime:.*Layouts:/)).toBeTruthy();
    expect(screen.getByText('Controls active')).toBeTruthy();
  });

  it('shows no status chrome for the player hud', async () => {
    await mount('player');
    expect(screen.queryByText(/Camera:/)).toBeNull();
    expect(screen.queryByText(/Realtime:/)).toBeNull();
    expect(screen.queryByText(/Layouts:/)).toBeNull();
    expect(screen.queryByText('Controls active')).toBeNull();
  });
});
