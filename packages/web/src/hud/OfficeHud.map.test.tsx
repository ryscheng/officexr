// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { SocialToastQueue } from '../ping/socialToasts';
import { createBuildSession } from '../place/buildSession';
import { SettingsProvider } from '../room/Settings';
import { fakePlayControls } from './fakePlayControls';
import { OfficeHud } from './OfficeHud';
import type { MissionsApi } from './missions/useMissions';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const missions: MissionsApi = { status: 'ready', error: null, missions: [], current: null, setCurrent() {}, create: async () => null, update: async () => true, remove: async () => {} };

function setup({ touch = false } = {}) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: touch && query.includes('pointer: coarse'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  );
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'bao', name: 'Bao', pos: { x: 8, y: 0, z: 6 } });
  store.setState(() => ({ realtime: { ...store.getState().realtime, status: 'live' } }));
  const mode = createPlaceMode();
  const build = createBuildSession(mode, vi.fn(async () => ({ ok: true as const })), () => store.getState().placedProps);
  const walk = fakePlayControls();
  render(
    <ApplicationProvider api={createDefaultApi({ fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: [] })) })}>
      <PlayControlsProvider controls={walk.controls}>
        <ViewYawProvider viewYaw={createViewYaw()}>
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
  return walk;
}

const mapButton = () => screen.getByRole('button', { name: 'Map' });
const mapDialog = () => screen.queryByRole('dialog', { name: 'Office map' });
const press = (key: string) => fireEvent.keyDown(window, { key });
const tapMap = () => {
  const svg = screen.getByRole('img', { name: 'Map of the office' });
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON() {} });
  fireEvent.click(svg, { clientX: 100, clientY: 100 });
};

describe('OfficeHud map toggle', () => {
  it('opens and closes with the Map button, which shows it is pressed', () => {
    setup();
    expect(mapButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mapButton());
    expect(mapDialog()).toBeTruthy();
    expect(mapButton().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(mapButton());
    expect(mapDialog()).toBeNull();
    expect(mapButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens and closes with M, and closes with Escape', () => {
    setup();
    press('m');
    expect(mapDialog()).toBeTruthy();
    press('m');
    expect(mapDialog()).toBeNull();
    press('m');
    press('Escape');
    expect(mapDialog()).toBeNull();
  });

  it('has no close button on the map', () => {
    setup();
    fireEvent.click(mapButton());
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });
});

describe('OfficeHud map tap to go', () => {
  it('walks to the tapped point and keeps the map open on desktop', () => {
    const walk = setup();
    fireEvent.click(mapButton());
    tapMap();
    expect(walk.groundGoTos).toHaveLength(1);
    expect(mapDialog()).toBeTruthy();
  });

  it('shows the target and route only while a map walk is under way', () => {
    const walk = setup();
    fireEvent.click(mapButton());
    tapMap();
    expect(screen.queryByRole('img', { name: 'Walking here' })).toBeNull();
    act(() => walk.set({ type: 'walking', targetId: 'ground-1', route: [] }));
    expect(screen.getByRole('img', { name: 'Walking here' })).toBeTruthy();
    act(() => walk.set({ type: 'walking', targetId: 'bao', route: [] }));
    expect(screen.queryByRole('img', { name: 'Walking here' })).toBeNull();
    act(() => walk.set({ type: 'walking', targetId: 'ground-1', route: [] }));
    act(() => walk.set({ type: 'idle' }));
    expect(screen.queryByRole('img', { name: 'Walking here' })).toBeNull();
  });

  it('closes the map after a tap on a touch device so the walk shows', () => {
    const walk = setup({ touch: true });
    fireEvent.click(mapButton());
    tapMap();
    expect(walk.groundGoTos).toHaveLength(1);
    expect(mapDialog()).toBeNull();
  });

  it('stays open and says so when the point cannot be reached, on touch too', () => {
    const walk = setup({ touch: true });
    walk.refuseGround();
    fireEvent.click(mapButton());
    tapMap();
    expect(mapDialog()).toBeTruthy();
    expect(screen.getByText("Can't go there")).toBeTruthy();
  });
});
