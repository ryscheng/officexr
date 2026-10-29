// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createActions, createBus, createStore, type OfficeState } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { createViewYaw, ViewYawProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceList, presenceRows } from './PresenceList';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const player = (id: string, name: string) => ({
  id,
  name,
  status: 'available' as const,
  mic: 'none' as const,
  distanceM: 3,
  bearingDeg: 45,
});

const renderInView = (ui: ReactNode, viewYaw = createViewYaw()) =>
  render(<ViewYawProvider viewYaw={viewYaw}>{ui}</ViewYawProvider>);

describe('presenceRows', () => {
  it('sorts by name with self first and flags the self row', () => {
    const rows = presenceRows([player('zed', 'Zed'), player('me', 'Zoe'), player('amy', 'Amy')], [], 'me');
    expect(rows.map((r) => [r.label, r.type])).toEqual([
      ['Zoe', 'self'],
      ['Amy', 'peer'],
      ['Zed', 'peer'],
    ]);
  });

  it('lists departed users after present ones, by name', () => {
    const rows = presenceRows(
      [player('zed', 'Zed'), player('me', 'Zoe')],
      [
        { id: 'bea', name: 'Bea', leftAt: 5 },
        { id: 'abe', name: 'Abe', leftAt: 9 },
      ],
      'me',
    );
    expect(rows.map((r) => [r.label, r.type])).toEqual([
      ['Zoe', 'self'],
      ['Zed', 'peer'],
      ['Abe', 'departed'],
      ['Bea', 'departed'],
    ]);
  });

  it('drops a departed entry for a user who is present again', () => {
    const rows = presenceRows([player('bob', 'Bob')], [{ id: 'bob', name: 'Bob', leftAt: 0 }], 'me');
    expect(rows.map((r) => r.type)).toEqual(['peer']);
  });

  it('gives distance and bearing to peers only', () => {
    const [self, peer] = presenceRows([player('me', 'Me'), player('amy', 'Amy')], [], 'me');
    expect(self).not.toHaveProperty('distanceM');
    expect(self).not.toHaveProperty('bearingDeg');
    expect(peer).toMatchObject({ distanceM: 3, bearingDeg: 45 });
  });

  it('shows Joining… for an empty name', () => {
    expect(presenceRows([player('bob', '')], [], 'me').map((r) => r.label)).toEqual(['Joining…']);
  });

  it('puts unnamed rows last and never numbers them', () => {
    const rows = presenceRows([player('a#1', ''), player('a#2', ''), player('amy', 'Amy')], [], 'me');
    expect(rows.map((r) => r.label)).toEqual(['Amy', 'Joining…', 'Joining…']);
  });

  it('numbers windows sharing a login in join order', () => {
    const rows = presenceRows([player('mark#c', 'Mark'), player('mark#a', 'Mark'), player('mark#b', 'Mark')], [], 'other');
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ['mark#c', 'Mark'],
      ['mark#a', 'Mark (2)'],
      ['mark#b', 'Mark (3)'],
    ]);
  });
});

const rowOf = (name: string) => screen.getByText(name).closest('li')!;

describe('PresenceList', () => {
  function seed() {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    const viewYaw = createViewYaw();
    let t = 0;
    const clock = () => t;
    const setTime = (ms: number) => {
      t = ms;
    };
    actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
    const peer = (id: string, name: string, pos: { x: number; z: number }) =>
      actions.upsertPlayer({ id, name, pos: { ...pos, y: 0 } });
    peer('ann', 'Ann', { x: 0, z: -12 });
    peer('bob', 'Bob', { x: 0.4, z: 0 });
    peer('cat', 'Cat', { x: -3, z: 0 });
    peer('dan', 'Dan', { x: 3, z: 0 });
    actions.applyRemotePresence('ann', 'available', 'speaking', 0);
    actions.applyRemotePresence('bob', 'away', 'muted', 0);
    actions.applyRemotePresence('cat', 'available', 'silent', 10_000);
    actions.recordDeparted('dan', 0);
    actions.removePlayer('dan');
    vi.useFakeTimers();
    renderInView(<PresenceList store={store} selfId="me" officeName="HQ" clock={clock} />, viewYaw);
    return { actions, viewYaw, setTime };
  }

  const dotOf = (name: string, label: string) => within(rowOf(name)).getByRole('img', { name: label });

  it('orders self, present users by name, then departed', () => {
    seed();
    const rows = within(screen.getByRole('list', { name: 'People in HQ' })).getAllByRole('listitem');
    expect(rows.map((li) => li.textContent?.replace(/\d+ m|<1 m/, ''))).toEqual([
      'Me (you)',
      'Ann',
      'Bob',
      'Cat',
      'Dan',
    ]);
    expect(screen.getByText('HQ (4)')).toBeTruthy();
  });

  it('colours dots by indicator and turns a silent peer red once stale', () => {
    const { setTime } = seed();
    expect(dotOf('Ann', 'Available').className).toContain('bg-green-500');
    expect(dotOf('Bob', 'Away').className).toContain('bg-yellow-400');
    expect(dotOf('Dan', 'Offline').className).toContain('bg-red-500');

    act(() => {
      setTime(20_000);
      vi.advanceTimersByTime(1000);
    });
    expect(dotOf('Ann', 'Unresponsive').className).toContain('bg-red-500');
    expect(dotOf('Cat', 'Available')).toBeTruthy();
    expect(dotOf('Bob', 'Away')).toBeTruthy();
  });

  it('shows your own dot from your status', () => {
    const { actions } = seed();
    expect(dotOf('Me (you)', 'Available')).toBeTruthy();
    act(() => actions.upsertPlayer({ id: 'me', status: 'away' }));
    expect(dotOf('Me (you)', 'Away').className).toContain('bg-yellow-400');
  });

  it('shows the mic state', () => {
    seed();
    const mic = (name: string) => within(rowOf(name)).queryAllByRole('img').slice(1);
    expect(mic('Me (you)')).toEqual([]);
    expect(mic('Ann').map((el) => el.getAttribute('aria-label'))).toEqual(['Speaking']);
    expect(mic('Bob').map((el) => el.getAttribute('aria-label'))).toEqual(['Muted']);
    expect(mic('Cat').map((el) => el.getAttribute('aria-label'))).toEqual(['Mic on']);
    expect(mic('Dan')).toEqual([]);
  });

  it('points an arrow at peers relative to the view and shows their distance', () => {
    const { viewYaw } = seed();
    const arrow = (name: string) => rowOf(name).querySelector<SVGElement>('.lucide-arrow-up');
    expect(within(rowOf('Ann')).getByText('12 m')).toBeTruthy();
    expect(within(rowOf('Bob')).getByText('<1 m')).toBeTruthy();
    expect(arrow('Ann')?.style.transform).toBe('rotate(0deg)');
    expect(arrow('Cat')?.style.transform).toBe('rotate(-90deg)');

    act(() => viewYaw.set(Math.PI / 2));
    expect(arrow('Ann')?.style.transform).toBe('rotate(90deg)');
    expect(arrow('Cat')?.style.transform).toBe('rotate(0deg)');
    expect(arrow('Me (you)')).toBeNull();
    expect(arrow('Dan')).toBeNull();
    expect(within(rowOf('Dan')).queryByText(/ m$/)).toBeNull();
  });
});

describe('PresenceList between clients', () => {
  it('follows peers joining and leaving', async () => {
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice');
    const clock = () => harness.clock.now();
    renderInView(<PresenceList store={alice.store} selfId="alice" officeName="HQ" clock={clock} />);
    expect(screen.getByText('HQ (1)')).toBeTruthy();

    const bob = await harness.add('bob');
    expect(screen.getByText('Joining…')).toBeTruthy();
    act(() => bob.actions.upsertPlayer({ id: 'bob', name: 'Bob' }));
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('HQ (2)')).toBeTruthy();

    act(() => harness.remove('bob'));
    expect(within(rowOf('Bob')).getByRole('img', { name: 'Offline' })).toBeTruthy();
    expect(screen.getByText('HQ (1)')).toBeTruthy();
  });

  it('shows the connection status as text', async () => {
    const alice = await createMultiClientHarness().add('alice');
    renderInView(<PresenceList store={alice.store} selfId="alice" officeName="HQ" />);
    const expected = {
      connecting: 'Connecting…',
      live: 'Connected',
      reconnecting: 'Reconnecting…',
      'snapshot-pending': 'Connecting…',
      replaced: 'Disconnected',
    } satisfies Record<OfficeState['realtime']['status'], string>;
    for (const [status, text] of Object.entries(expected)) {
      act(() => alice.actions.setRealtimeStatus(status as keyof typeof expected));
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});
