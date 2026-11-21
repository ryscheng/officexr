// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePlayControls } from './fakePlayControls';
import type { PingSender } from '../ping/usePingSender';
import { createLocalMutes } from './localMutes';
import { PeopleSheet } from './PeopleSheet';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Callbacks = { onWave: () => void; onInvite: () => void; onClose: () => void };

function seed({
  pinger,
  portrait = false,
  callbacks = {},
  mutes = createLocalMutes(null),
}: { pinger?: PingSender; portrait?: boolean; callbacks?: Partial<Callbacks>; mutes?: ReturnType<typeof createLocalMutes> } = {}) {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  const play = fakePlayControls();
  let t = 0;
  const clock = () => t;
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  const peer = (id: string, name: string, pos: { x: number; z: number }) => actions.upsertPlayer({ id, name, pos: { ...pos, y: 0 } });
  peer('ann', 'Ann Lopez', { x: 0, z: -12 });
  peer('bob', 'Bob', { x: 0.4, z: 0 });
  peer('cat', 'Cat', { x: -3, z: 0 });
  peer('dan', 'Dan', { x: 3, z: 0 });
  actions.applyRemotePresence('ann', 'available', 'speaking', 0, { room: null, participantId: null });
  actions.applyRemotePresence('bob', 'away', 'muted', 0, { room: null, participantId: null });
  actions.applyRemotePresence('cat', 'available', 'silent', 10_000, { room: null, participantId: null });
  actions.recordDeparted('dan', 0);
  actions.removePlayer('dan');
  vi.useFakeTimers();
  const calls: Callbacks = { onWave: vi.fn(), onInvite: vi.fn(), onClose: vi.fn(), ...callbacks };
  render(
    <PlayControlsProvider controls={play.controls}>
      <ViewYawProvider viewYaw={createViewYaw()}>
        <PeopleSheet store={store} selfId="me" officeName="HQ" pinger={pinger} mutes={mutes} portrait={portrait} clock={clock} {...calls} />
      </ViewYawProvider>
    </PlayControlsProvider>,
  );
  return { actions, play, calls, mutes, setTime: (ms: number) => void (t = ms) };
}

const rowOf = (name: string) => screen.getByText(name).closest('li')!;
const openCard = (name: string) => fireEvent.click(within(rowOf(name)).getByRole('button', { name: /Show options$/ }));

describe('PeopleSheet list', () => {
  it('counts people in the title and orders self, present peers by name, then people who left', () => {
    seed();
    expect(screen.getByRole('dialog', { name: 'People here · 4' })).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'People in HQ' })).getAllByRole('listitem');
    expect(rows.map((li) => li.querySelector('.truncate')?.textContent)).toEqual(['Me (you)', 'Ann Lopez', 'Bob', 'Cat', 'Dan']);
  });

  it('says the status in words with the distance, and Left for someone who left', () => {
    seed();
    expect(within(rowOf('Me (you)')).getByText('Available')).toBeTruthy();
    expect(within(rowOf('Ann Lopez')).getByText('Available · 12 m')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('Away · <1 m')).toBeTruthy();
    expect(within(rowOf('Dan')).getByText('Left')).toBeTruthy();
  });

  it('turns a silent peer Unresponsive once stale', () => {
    const { setTime } = seed();
    act(() => {
      setTime(20_000);
      vi.advanceTimersByTime(1000);
    });
    expect(within(rowOf('Ann Lopez')).getByText('Unresponsive · 12 m')).toBeTruthy();
    expect(within(rowOf('Cat')).getByText('Available · 3 m')).toBeTruthy();
  });

  it('shows how long ago an idle peer was last active, from a minute on', () => {
    const { actions } = seed();
    const idle = (id: string, idleMs?: number) => actions.applyRemotePresence(id, 'available', 'none', 0, { room: null, participantId: null }, idleMs);
    act(() => {
      idle('ann', 5 * 60_000);
      idle('bob', 30_000);
    });
    expect(within(rowOf('Ann Lopez')).getByText('Available · Active 5m ago · 12 m')).toBeTruthy();
    expect(within(rowOf('Bob')).queryByText(/Active/)).toBeNull();
  });

  it('offers Go on present peers only; it walks and closes the sheet', () => {
    const { play, calls } = seed();
    expect(within(rowOf('Me (you)')).queryByRole('button', { name: /^Go/ })).toBeNull();
    expect((within(rowOf('Dan')).getByRole('button', { name: 'Go to Dan' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(rowOf('Bob')).getByRole('button', { name: 'Go to Bob' }));
    expect(play.goTos).toEqual(['bob']);
    expect(calls.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not open a card for yourself or for someone who left', () => {
    seed();
    expect(within(rowOf('Me (you)')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Dan')).queryByRole('button', { name: /Show options$/ })).toBeNull();
  });

  it('shows an empty state with Invite people when you are alone', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    createActions(store, createBus()).upsertPlayer({ id: 'me', name: 'Me' });
    const onInvite = vi.fn();
    render(
      <PlayControlsProvider controls={fakePlayControls().controls}>
        <ViewYawProvider viewYaw={createViewYaw()}>
          <PeopleSheet store={store} selfId="me" officeName="HQ" mutes={createLocalMutes(null)} portrait={false} onWave={() => {}} onInvite={onInvite} onClose={() => {}} />
        </ViewYawProvider>
      </PlayControlsProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'People here · 1' })).toBeTruthy();
    expect(screen.getByText('Only you are here.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('has no empty state while someone else is here', () => {
    seed();
    expect(screen.queryByText('Only you are here.')).toBeNull();
  });

  it('disables Go for everyone while offline', () => {
    const { actions } = seed();
    act(() => actions.setRealtimeStatus('reconnecting'));
    expect((within(rowOf('Bob')).getByRole('button', { name: 'Go to Bob' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes from the close button and on Escape', () => {
    const { calls } = seed();
    fireEvent.click(screen.getByRole('button', { name: 'Close people' }));
    expect(calls.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(calls.onClose).toHaveBeenCalledTimes(2);
  });

  it('renders as a bottom sheet in portrait', () => {
    seed({ portrait: true });
    const sheet = screen.getByRole('dialog', { name: 'People here · 4' });
    expect(sheet.hasAttribute('data-hud-modal')).toBe(true);
    expect(within(sheet).getByRole('button', { name: 'Close people' })).toBeTruthy();
  });
});

describe('PeopleSheet person card', () => {
  const card = () => screen.getByRole('dialog', { name: 'Person' });

  it('opens from a row with the full name, status, and the four actions, and no More…', () => {
    seed();
    openCard('Ann Lopez');
    expect(within(card()).getByText('Ann Lopez')).toBeTruthy();
    expect(within(card()).getByText('Available · 12 m')).toBeTruthy();
    for (const name of ['Go to Ann', 'Wave', 'Mute for me', 'Ping']) {
      expect(within(card()).getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'People in HQ' })).toBeNull();
  });

  it('shows the status text of the person', () => {
    const { actions } = seed();
    act(() => actions.upsertPlayer({ id: 'ann', statusText: 'Working on the launch plan' }));
    openCard('Ann Lopez');
    expect(within(card()).getByText('Working on the launch plan')).toBeTruthy();
  });

  it('lays the actions out in three columns on a touch landscape panel and two elsewhere', () => {
    seed();
    openCard('Cat');
    expect(within(card()).getByRole('button', { name: 'Wave' }).parentElement?.className).toContain('grid-cols-2');
    cleanup();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    seed();
    openCard('Cat');
    expect(within(card()).getByRole('button', { name: 'Wave' }).parentElement?.className).toContain('grid-cols-3');
  });

  it('goes back to the list with the back button', () => {
    seed();
    openCard('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Back to people' }));
    expect(screen.getByRole('list', { name: 'People in HQ' })).toBeTruthy();
  });

  it('falls back to the list when the person leaves', () => {
    const { actions } = seed();
    openCard('Bob');
    act(() => {
      actions.recordDeparted('bob', 1);
      actions.removePlayer('bob');
    });
    expect(screen.getByRole('list', { name: 'People in HQ' })).toBeTruthy();
  });

  it('Go walks to the person and closes the sheet', () => {
    const { play, calls } = seed();
    openCard('Cat');
    fireEvent.click(within(card()).getByRole('button', { name: 'Go to Cat' }));
    expect(play.goTos).toEqual(['cat']);
    expect(calls.onClose).toHaveBeenCalledTimes(1);
  });

  it('Wave calls the wave action and keeps the sheet open', () => {
    const { calls } = seed();
    openCard('Cat');
    fireEvent.click(within(card()).getByRole('button', { name: 'Wave' }));
    expect(calls.onWave).toHaveBeenCalledTimes(1);
    expect(calls.onClose).not.toHaveBeenCalled();
  });

  it('Ping sends to the person, and shows Pinged and disables during cooldown', () => {
    const ping = vi.fn();
    seed({ pinger: { ping, isCoolingDown: (id) => id === 'bob' } });
    openCard('Cat');
    fireEvent.click(within(card()).getByRole('button', { name: 'Ping' }));
    expect(ping).toHaveBeenCalledWith('cat');
    fireEvent.click(screen.getByRole('button', { name: 'Back to people' }));
    openCard('Bob');
    const pinged = within(card()).getByRole('button', { name: 'Pinged' }) as HTMLButtonElement;
    expect(pinged.disabled).toBe(true);
  });

  it('disables Go and Ping while offline, saying why', () => {
    const { actions } = seed({ pinger: { ping: () => {}, isCoolingDown: () => false } });
    openCard('Cat');
    expect(within(card()).queryByText(/^Offline/)).toBeNull();
    act(() => actions.setRealtimeStatus('reconnecting'));
    expect(within(card()).getByText(/^Offline/)).toBeTruthy();
    expect((within(card()).getByRole('button', { name: 'Ping' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card()).getByRole('button', { name: 'Go to Cat' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Mute for me toggles a local mute by login, and the row says Muted', () => {
    const mutes = createLocalMutes(null);
    seed({ mutes });
    openCard('Cat');
    const button = () => within(card()).getByRole('button', { name: /mute/i });
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect([...mutes.get()]).toEqual(['cat']);
    expect(within(card()).getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(card()).getByText('Available · 3 m · Muted')).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: 'Unmute' }));
    expect(mutes.get().size).toBe(0);
  });
});

describe('PeopleSheet between clients', () => {
  it('follows peers joining and leaving', async () => {
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice');
    const clock = () => harness.clock.now();
    render(
      <PlayControlsProvider controls={fakePlayControls().controls}>
        <ViewYawProvider viewYaw={createViewYaw()}>
          <PeopleSheet store={alice.store} selfId="alice" officeName="HQ" mutes={createLocalMutes(null)} portrait={false} onWave={() => {}} onInvite={() => {}} onClose={() => {}} clock={clock} />
        </ViewYawProvider>
      </PlayControlsProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'People here · 1' })).toBeTruthy();

    const bob = await harness.add('bob');
    expect(screen.getByText('Joining…')).toBeTruthy();
    act(() => bob.actions.upsertPlayer({ id: 'bob', name: 'Bob' }));
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'People here · 2' })).toBeTruthy();

    act(() => harness.remove('bob'));
    expect(within(rowOf('Bob')).getByText('Left')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'People here · 1' })).toBeTruthy();
  });
});
