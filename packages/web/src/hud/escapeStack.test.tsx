// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { PlayControlsProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { SettingsHarness, openMenu, openPage } from '../room/settingsHarness';
import { useSettings } from '../room/Settings';
import { ChatPanel } from './ChatPanel';
import { useEscapeFallback } from './useEscapeLayer';
import { fakePlayControls } from './fakePlayControls';
import { PingInboxHud } from './PingInboxHud';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
});

const settingsDialog = () => screen.queryByRole('dialog');

function OpenSettingsOnEsc() {
  const { open } = useSettings();
  useEscapeFallback(() => open());
  return null;
}

function setup(children?: React.ReactNode) {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  const actions = createActions(store, createBus());
  const inbox = new PingInbox();
  inbox.add('ada#t1', 'Ada');
  render(
    <PlayControlsProvider controls={fakePlayControls().controls}>
      <SettingsHarness pages={{ help: <p>pane body</p> }}>
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
    expect(screen.getByRole('list', { name: 'Received pings' })).toBeTruthy();
    esc();
    expect(screen.queryByRole('list', { name: 'Received pings' })).toBeNull();
    expect(settingsDialog()).toBeNull();
  });

  it('closes Settings before the inbox beneath it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Pings/ }));
    openMenu();
    esc(settingsDialog()!);
    expect(settingsDialog()).toBeNull();
    expect(screen.getByRole('list', { name: 'Received pings' })).toBeTruthy();
    esc();
    expect(screen.queryByRole('list', { name: 'Received pings' })).toBeNull();
  });

  it('keeps Settings closed while Esc is held', () => {
    setup();
    fireEvent.keyDown(window, { key: 'Escape', repeat: true });
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
    openMenu();
    openPage('Help');
    expect(screen.getByText('pane body')).toBeTruthy();
    esc(settingsDialog()!);
    expect(screen.queryByText('pane body')).toBeNull();
    expect(settingsDialog()).not.toBeNull();
    esc(settingsDialog()!);
    expect(settingsDialog()).toBeNull();
  });

  it('closes only the chat from its input', () => {
    setup();
    fireEvent.keyDown(window, { key: 'Enter' });
    const input = screen.getByPlaceholderText('Press Enter to chat');
    esc(input);
    expect(document.activeElement).not.toBe(input);
    expect(settingsDialog()).toBeNull();
  });
});
