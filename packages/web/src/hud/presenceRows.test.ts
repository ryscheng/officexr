import { describe, expect, it } from 'vitest';
import { presenceRows } from './presenceRows';

const player = (id: string, name: string) => ({
  id,
  name,
  status: 'available' as const,
  mic: 'none' as const,
  distanceM: 3,
  bearingDeg: 45,
});

describe('presenceRows', () => {
  it('sorts by name with self first and flags the self row', () => {
    const rows = presenceRows([player('zed', 'Zed'), player('me', 'Zoe'), player('amy', 'Amy')], [], 'me');
    expect(rows.map((r) => [r.label, r.type])).toEqual([
      ['Zoe (you)', 'self'],
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
      ['Zoe (you)', 'self'],
      ['Zed', 'peer'],
      ['Abe', 'departed'],
      ['Bea', 'departed'],
    ]);
  });

  it('drops a departed entry for a user who is present again', () => {
    const rows = presenceRows([player('bob', 'Bob')], [{ id: 'bob', name: 'Bob', leftAt: 0 }], 'me');
    expect(rows.map((r) => r.type)).toEqual(['peer']);
  });

  it('drops a departed entry for a user who never sent a name', () => {
    expect(presenceRows([], [{ id: 'bob', name: '', leftAt: 0 }], 'me')).toEqual([]);
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
