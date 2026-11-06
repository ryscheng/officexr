// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { PlayControlsProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { SettingsHarness, openSettings } from '../room/settingsHarness';
import { useSettings } from '../room/Settings';
import { ChatPanel } from './ChatPanel';
import { useEscapeFallback } from './useEscapeLayer';
import { fakePlayControls } from './fakePlayControls';
import { PingInboxHud } from './PingInboxHud';

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
});

const settingsDialog = () => screen.queryByRole('dialog');

function OpenSettingsOnEsc() {
  const { open, openPane } = useSettings();
  useEscapeFallback(() => open());
  return <button onClick={() => openPane('pane')}>pane</button>;
}

function setup(children?: React.ReactNode) {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  const actions = createActions(store, createBus());
  const inbox = new PingInbox();
  render(
    <PlayControlsProvider controls={fakePlayControls().controls}>
      <SettingsHarness>
        <OpenSettingsOnEsc />
        <PingInboxHud inbox={inbox} store={store} />
        <ChatPanel store={store} actions={actions} selfId="me#t0" />
        {children}
      </SettingsHarness>
    </PlayControlsProvider>,
  );
}

const esc = (target: Element | Window = window) => fireEvent.keyDown(target, { key: 'Escape' });

describe('Escape stack', () => {
  it('closes the open ping inbox without opening Settings', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Pings/ }));
    expect(screen.getByText('No pings yet')).toBeTruthy();
    esc();
    expect(screen.queryByText('No pings yet')).toBeNull();
    expect(settingsDialog()).toBeNull();
  });

  it('opens Settings when nothing is open and the pointer is free', () => {
    setup();
    esc();
    expect(settingsDialog()).not.toBeNull();
  });

  it('opens nothing while the pointer is locked', () => {
    setup();
    Object.defineProperty(document, 'pointerLockElement', { value: document.body, configurable: true });
    esc();
    expect(settingsDialog()).toBeNull();
  });

  it('goes back from a Settings pane, then closes', () => {
    setup();
    openSettings();
    act(() => void screen.getByText('pane').click());
    esc(settingsDialog()!);
    expect(settingsDialog()).not.toBeNull();
    esc(settingsDialog()!);
    expect(settingsDialog()).toBeNull();
  });

  it('closes only the chat from its input', () => {
    setup();
    fireEvent.keyDown(window, { key: 'Enter' });
    const input = screen.getByPlaceholderText('Type a message...');
    esc(input);
    expect(screen.queryByPlaceholderText('Type a message...')).toBeNull();
    expect(settingsDialog()).toBeNull();
  });
});
