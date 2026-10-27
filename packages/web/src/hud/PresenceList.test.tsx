// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { OfficeState } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { afterEach, describe, expect, it } from 'vitest';
import { PresenceList, presenceRows } from './PresenceList';

afterEach(cleanup);

describe('presenceRows', () => {
  it('sorts by name with self first and flags the self row', () => {
    const rows = presenceRows(
      [
        { id: 'zed', name: 'Zed' },
        { id: 'me', name: 'Zoe' },
        { id: 'amy', name: 'Amy' },
      ],
      'me',
    );
    expect(rows.map((r) => [r.label, r.isSelf])).toEqual([
      ['Zoe', true],
      ['Amy', false],
      ['Zed', false],
    ]);
  });

  it('shows Joining… for an empty name', () => {
    expect(presenceRows([{ id: 'bob', name: '' }], 'me').map((r) => r.label)).toEqual(['Joining…']);
  });

  it('puts unnamed rows last and never numbers them', () => {
    const rows = presenceRows(
      [
        { id: 'a#1', name: '' },
        { id: 'a#2', name: '' },
        { id: 'amy', name: 'Amy' },
      ],
      'me',
    );
    expect(rows.map((r) => r.label)).toEqual(['Amy', 'Joining…', 'Joining…']);
  });

  it('numbers windows sharing a login in join order', () => {
    const rows = presenceRows(
      [
        { id: 'mark#c', name: 'Mark' },
        { id: 'mark#a', name: 'Mark' },
        { id: 'mark#b', name: 'Mark' },
      ],
      'other',
    );
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ['mark#c', 'Mark'],
      ['mark#a', 'Mark (2)'],
      ['mark#b', 'Mark (3)'],
    ]);
  });
});

describe('PresenceList between clients', () => {
  it('follows peers joining and leaving', async () => {
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice');
    render(<PresenceList store={alice.store} selfId="alice" officeName="HQ" />);
    expect(screen.getByText('HQ (1)')).toBeTruthy();

    const bob = await harness.add('bob');
    expect(screen.getByText('Joining…')).toBeTruthy();
    act(() => bob.actions.upsertPlayer({ id: 'bob', name: 'Bob' }));
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('HQ (2)')).toBeTruthy();

    act(() => harness.remove('bob'));
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.getByText('HQ (1)')).toBeTruthy();
  });

  it('shows the connection status as text', async () => {
    const alice = await createMultiClientHarness().add('alice');
    render(<PresenceList store={alice.store} selfId="alice" officeName="HQ" />);
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
