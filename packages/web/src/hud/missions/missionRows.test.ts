import type { Mission } from '@officexr/sdk';
import { describe, expect, it } from 'vitest';
import {
  filterBySource,
  metaLine,
  missionDistances,
  orderMissions,
  placeAreas,
  resolvePlace,
  sameDistances,
  sourceChips,
  stepsLabel,
  tabMissions,
  todayProgress,
} from './missionRows';

const NOW = new Date(2026, 10, 20, 9, 0);
const local = (h: number, m: number, day = 20) => new Date(2026, 10, day, h, m).toISOString();

const mission = (id: string, over: Partial<Mission> = {}): Mission => ({
  id,
  officeId: 'o',
  source: 'mine',
  ownerLogin: 'me',
  title: id,
  steps: [],
  place: null,
  dueAt: null,
  personLogin: null,
  shared: false,
  done: false,
  createdAt: local(8, 0),
  updatedAt: local(8, 0),
  ...over,
});

describe('tabMissions', () => {
  const all = [mission('a'), mission('b', { ownerLogin: 'bao', shared: true }), mission('c', { ownerLogin: 'bao' }), mission('d', { shared: true })];

  it('Mine is everything I own', () => {
    expect(tabMissions(all, 'me', 'mine').map((m) => m.id)).toEqual(['a', 'd']);
  });

  it('Team is what others shared, not my own shared ones and not their private ones', () => {
    expect(tabMissions(all, 'me', 'team').map((m) => m.id)).toEqual(['b']);
  });
});

describe('sourceChips', () => {
  it('offers All and Mine only, while no other source has a mission', () => {
    expect(sourceChips([mission('a')])).toEqual(['all', 'mine']);
    expect(sourceChips([])).toEqual(['all', 'mine']);
  });

  it('adds a source once it has a mission', () => {
    expect(sourceChips([mission('a'), mission('b', { source: 'linear' })])).toEqual(['all', 'mine', 'linear']);
  });

  it('filters by source', () => {
    const list = [mission('a'), mission('b', { source: 'linear' })];
    expect(filterBySource(list, 'linear').map((m) => m.id)).toEqual(['b']);
    expect(filterBySource(list, 'all')).toHaveLength(2);
  });
});

describe('orderMissions', () => {
  it('puts the current one first, then by due time, and done ones last', () => {
    const list = [
      mission('done', { done: true, dueAt: local(7, 0) }),
      mission('late', { dueAt: local(15, 0) }),
      mission('undated'),
      mission('early', { dueAt: local(10, 0) }),
      mission('now'),
    ];
    expect(orderMissions(list, 'now').map((m) => m.id)).toEqual(['now', 'early', 'late', 'undated', 'done']);
  });

  it('keeps a done current mission at the end', () => {
    expect(orderMissions([mission('a', { done: true }), mission('b')], 'a').map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('todayProgress', () => {
  it('counts done today out of open ones due today or undated, plus done today', () => {
    const list = [
      mission('open'),
      mission('dueToday', { dueAt: local(15, 0) }),
      mission('dueLater', { dueAt: local(9, 0, 25) }),
      mission('doneToday', { done: true, updatedAt: local(8, 30) }),
      mission('doneBefore', { done: true, updatedAt: local(8, 30, 18) }),
    ];
    expect(todayProgress(list, NOW)).toEqual({ done: 1, total: 3 });
  });

  it('counts an overdue open mission', () => {
    expect(todayProgress([mission('a', { dueAt: local(9, 0, 10) })], NOW)).toEqual({ done: 0, total: 1 });
  });
});

describe('metaLine and stepsLabel', () => {
  it('joins place and due, with the time alone for today', () => {
    const m = mission('a', { place: { kind: 'room', id: 'r', label: 'Kitchen' }, dueAt: local(11, 30) });
    expect(metaLine(m, NOW)).toBe('Kitchen · Due 11:30');
  });

  it('names the weekday for another day', () => {
    expect(metaLine(mission('a', { dueAt: local(15, 0, 21) }), NOW)).toMatch(/^Due \w+ 15:00$/);
  });

  it('shows Complete with the time for a done mission', () => {
    expect(metaLine(mission('a', { done: true, updatedAt: local(9, 12) }), NOW)).toBe('Complete · 09:12');
  });

  it('adds the step count only when asked', () => {
    const m = mission('a', { steps: [{ text: 'x', done: true }, { text: 'y', done: false }, { text: 'z', done: false }] });
    expect(stepsLabel(m)).toBe('1 of 3 steps');
    expect(metaLine(m, NOW)).toBe('');
    expect(metaLine(m, NOW, true)).toBe('1 of 3');
    expect(stepsLabel(mission('b'))).toBeNull();
  });
});

describe('resolvePlace', () => {
  const room = { id: 'r1', label: 'Room', min: { x: 0, z: 0 }, max: { x: 10, z: 4 } };
  const desk = { id: 'd1', label: 'Desk', min: { x: 20, z: 20 }, max: { x: 22, z: 22 } };

  it('finds the centre of a room or a desk', () => {
    const areas = placeAreas([room], [desk]);
    expect(resolvePlace({ kind: 'room', id: 'r1', label: 'Room' }, areas)).toEqual({ x: 5, z: 2 });
    expect(resolvePlace({ kind: 'desk', id: 'd1', label: 'Desk' }, areas)).toEqual({ x: 21, z: 21 });
  });

  it('is null for a place the map no longer has', () => {
    expect(resolvePlace({ kind: 'room', id: 'gone', label: 'Gone' }, placeAreas([room], []))).toBeNull();
  });

  it('does not list a desk zone as a room', () => {
    expect(placeAreas([room, { ...desk }], [desk]).rooms.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('mission distances', () => {
  const areas = placeAreas([{ id: 'r1', label: 'Room', min: { x: 10, z: 0 }, max: { x: 20, z: 10 } }], []);
  const at = (id: string, place: Mission['place']) => mission(id, { place });
  const missions = [at('a', { kind: 'room', id: 'r1', label: 'Room' }), at('b', { kind: 'room', id: 'gone', label: 'Gone' }), at('c', null)];

  it('floors to whole metres and skips missions without a known place', () => {
    expect([...missionDistances(missions, areas, { x: 0, z: 5 })]).toEqual([['a', 15]]);
    expect([...missionDistances(missions, areas, { x: 0.4, z: 5 })]).toEqual([['a', 14]]);
  });

  it('is empty until the position is known', () => {
    expect(missionDistances(missions, areas, null).size).toBe(0);
  });

  it('compares by value', () => {
    expect(sameDistances(new Map([['a', 15]]), new Map([['a', 15]]))).toBe(true);
    expect(sameDistances(new Map([['a', 15]]), new Map([['a', 14]]))).toBe(false);
  });
});
