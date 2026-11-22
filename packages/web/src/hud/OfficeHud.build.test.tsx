// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { SocialToastQueue } from '../ping/socialToasts';
import { createBuildSession } from '../place/buildSession';
import { SettingsProvider } from '../room/Settings';
import { fakePlayControls } from './fakePlayControls';
import { OfficeHud } from './OfficeHud';
import type { MissionsApi } from './missions/useMissions';

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const missions: MissionsApi = { status: 'ready', error: null, missions: [], current: null, setCurrent() {}, create: async () => null, update: async () => true, remove: async () => {} };

function setup() {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  store.setState(() => ({ realtime: { ...store.getState().realtime, status: 'live' } }));
  const mode = createPlaceMode();
  const send = vi.fn(async () => ({ ok: true as const }));
  const build = createBuildSession(mode, send, () => store.getState().placedProps);
  const viewYaw = createViewYaw();
  render(
    <ApplicationProvider api={createDefaultApi({ fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: [] })) })}>
    <PlayControlsProvider controls={fakePlayControls().controls}>
      <ViewYawProvider viewYaw={viewYaw}>
        <SettingsProvider>
          <OfficeHud
            store={store}
            actions={actions}
            selfId="me"
            joystickFloats={false}
            me="me"
            officeName="Office"
            voice={null}
            pinger={{ ping() {}, isCoolingDown: () => false }}
            inviter={{ ping() {}, isCoolingDown: () => false }}
            waver={{ ping() {}, isCoolingDown: () => false }}
            socialToasts={new SocialToastQueue()}
            pingInbox={new PingInbox()}
            missions={missions}
            placeMode={mode}
            build={build}
            toasts={null}
            inviteUrl="https://example.test/o"
            onWave={() => {}}
            settingsPages={{ profile: null, controls: null, alerts: null, office: null, help: null }}
            onSwitchOffice={() => {}}
            onSignOut={async () => {}}
          />
        </SettingsProvider>
      </ViewYawProvider>
    </PlayControlsProvider>
    </ApplicationProvider>,
  );
  return { mode, send };
}

describe('OfficeHud build mode', () => {
  it('swaps the HUD for the palette on entry and back on Done', () => {
    const { mode } = setup();
    expect(screen.queryByRole('radiogroup', { name: 'Props' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Map' })).toBeTruthy();
    act(() => mode.setOpen(true));
    expect(screen.getByRole('radiogroup', { name: 'Props' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Place' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Map' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Office menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mode.get().open).toBe(false);
    expect(screen.queryByRole('radiogroup', { name: 'Props' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Map' })).toBeTruthy();
  });

  it('Escape leaves build mode instead of opening the menu', () => {
    const { mode } = setup();
    act(() => mode.setOpen(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mode.get().open).toBe(false);
  });
});
