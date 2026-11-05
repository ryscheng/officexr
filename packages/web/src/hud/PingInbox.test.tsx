// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore } from '@officexr/sdk';
import { PlayControlsProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PingInbox } from '../ping/pingInbox';
import { fakePlayControls } from './fakePlayControls';
import { PingInboxHud } from './PingInbox';

afterEach(cleanup);

function setup(present: string[] = ['ada#t1']) {
  let now = 1_000_000;
  const inbox = new PingInbox(() => now);
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  store.setState((s) => ({ ...s, players: Object.fromEntries(present.map((id) => [id, { name: id }])) as never }));
  const play = fakePlayControls();
  render(
    <PlayControlsProvider controls={play.controls}>
      <PingInboxHud inbox={inbox} store={store} />
    </PlayControlsProvider>,
  );
  const ping = (fromId: string, name: string) => act(() => inbox.add(fromId, name));
  return { inbox, play, ping, advance: (ms: number) => (now += ms) };
}

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'Pings' }));

describe('PingInboxHud', () => {
  it('shows the unread count, capped at 9+, and clears it on open', () => {
    const { ping } = setup();
    expect(screen.queryByRole('status')).toBeNull();
    ping('ada#t1', 'Ada');
    expect(screen.getByRole('status').textContent).toBe('1');
    for (let i = 0; i < 9; i++) {
      ping('ada#t1', 'Ada');
    }
    expect(screen.getByRole('status').textContent).toBe('9+');
    openPanel();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists name and relative time, and shows an empty state', () => {
    const { ping } = setup();
    openPanel();
    expect(screen.getByText('No pings yet')).toBeTruthy();
    ping('ada#t1', 'Ada');
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
  });

  it('goes to a present sender and disables Go to for a departed one', () => {
    const { ping, play } = setup(['ada#t1']);
    ping('ada#t1', 'Ada');
    ping('bob#t2', 'Bob');
    openPanel();
    expect((screen.getByRole('button', { name: 'Bob has left' }) as HTMLButtonElement).disabled).toBe(true);
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
