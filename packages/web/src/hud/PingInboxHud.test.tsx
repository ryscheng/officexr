// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore } from '@officexr/sdk';
import { PlayControlsProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { fakePlayControls } from './fakePlayControls';
import { PingInboxHud } from './PingInboxHud';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(present: string[] = ['ada#t1']) {
  const inbox = new PingInbox();
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  store.setState((s) => ({
    ...s,
    players: Object.fromEntries(present.map((id) => [id, { name: id }])) as never,
  }));
  const play = fakePlayControls();
  render(
    <PlayControlsProvider controls={play.controls}>
      <PingInboxHud inbox={inbox} store={store} />
    </PlayControlsProvider>,
  );
  const ping = (fromId: string, name: string) => act(() => inbox.add(fromId, name));
  return { inbox, play, ping };
}

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /^Pings/ }));

describe('PingInboxHud', () => {
  it('shows the unread count, capped at 9+, and clears it on open', () => {
    const { ping } = setup();
    expect(screen.getByRole('button', { name: 'Pings' })).toBeTruthy();
    ping('ada#t1', 'Ada');
    expect(screen.getByRole('button', { name: 'Pings, 1 unread' })).toBeTruthy();
    for (let i = 0; i < 9; i++) {
      ping('ada#t1', 'Ada');
    }
    expect(screen.getByRole('button', { name: 'Pings, 10 unread' })).toBeTruthy();
    expect(screen.getByText('9+')).toBeTruthy();
    openPanel();
    expect(screen.getByRole('button', { name: 'Pings' })).toBeTruthy();
  });

  it('lists name and relative time, and shows an empty state', () => {
    const { ping } = setup();
    openPanel();
    expect(screen.getByText('No pings yet')).toBeTruthy();
    ping('ada#t1', 'Ada');
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
  });

  it('shows the age and exact time as the clock advances', () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 12, 0, 0) });
    const { ping } = setup();
    ping('ada#t1', 'Ada');
    openPanel();
    act(() => {
      vi.advanceTimersByTime(150_000);
    });
    const time = screen.getByText('2m ago');
    expect(time.getAttribute('title')).toBe(new Date(2026, 0, 1, 12, 0, 0).toLocaleTimeString());
  });

  it('goes to a present sender and disables Go to for a departed one', () => {
    const { ping, play } = setup(['ada#t1']);
    ping('ada#t1', 'Ada');
    ping('bob#t2', 'Bob');
    openPanel();
    expect(
      (
        screen.getByRole('button', {
          name: 'Bob has left',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Ada' }));
    expect(play.goTos).toEqual(['ada#t1']);
  });

  it('clears the list and closes on Escape', () => {
    const { ping } = setup();
    ping('ada#t1', 'Ada');
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No pings yet')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('No pings yet')).toBeNull();
  });
});
