import { describe, expect, it } from 'vitest';
import { calendarStatus, STATUS_WINDOW_MS } from './calendarStatus';
import { createTtlCache } from './ttlCache';

const NOW = new Date('2026-11-20T14:20:00Z');
const busy = (start: string, end: string) => ({ start, end });
const windowEnd = new Date(NOW.getTime() + STATUS_WINDOW_MS).toISOString();

describe('calendarStatus', () => {
  it('is free until the end of the window with nothing booked', () => {
    expect(calendarStatus([], NOW)).toEqual({ busy: false, until: windowEnd });
  });

  it('is busy until the end of the current meeting', () => {
    expect(calendarStatus([busy('2026-11-20T14:00:00Z', '2026-11-20T15:00:00Z')], NOW)).toEqual({ busy: true, until: '2026-11-20T15:00:00.000Z' });
  });

  it('is free until the next meeting starts', () => {
    expect(calendarStatus([busy('2026-11-20T16:00:00Z', '2026-11-20T17:00:00Z')], NOW)).toEqual({ busy: false, until: '2026-11-20T16:00:00.000Z' });
  });

  it('treats back-to-back and overlapping meetings as one busy block', () => {
    const intervals = [busy('2026-11-20T15:30:00Z', '2026-11-20T16:00:00Z'), busy('2026-11-20T14:00:00Z', '2026-11-20T15:00:00Z'), busy('2026-11-20T14:50:00Z', '2026-11-20T15:30:00Z')];
    expect(calendarStatus(intervals, NOW)).toEqual({ busy: true, until: '2026-11-20T16:00:00.000Z' });
  });

  it('reads offsets as instants, so the same moment gives the same answer in any zone', () => {
    const utc = calendarStatus([busy('2026-11-20T14:00:00Z', '2026-11-20T15:00:00Z')], NOW);
    const tokyo = calendarStatus([busy('2026-11-20T23:00:00+09:00', '2026-11-21T00:00:00+09:00')], NOW);
    const newYork = calendarStatus([busy('2026-11-20T09:00:00-05:00', '2026-11-20T10:00:00-05:00')], NOW);
    expect(tokyo).toEqual(utc);
    expect(newYork).toEqual(utc);
  });

  it('is free the moment a meeting ends and busy the moment one starts', () => {
    const meeting = [busy('2026-11-20T14:20:00Z', '2026-11-20T15:00:00Z')];
    expect(calendarStatus(meeting, NOW).busy).toBe(true);
    expect(calendarStatus(meeting, new Date('2026-11-20T15:00:00Z')).busy).toBe(false);
  });

  it('ignores past meetings and malformed or empty intervals', () => {
    const intervals = [busy('2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z'), busy('not a date', '2026-11-20T15:00:00Z'), busy('2026-11-20T15:00:00Z', '2026-11-20T15:00:00Z')];
    expect(calendarStatus(intervals, NOW)).toEqual({ busy: false, until: windowEnd });
  });

  it('never reports free-until past the window', () => {
    expect(calendarStatus([busy('2026-11-21T20:00:00Z', '2026-11-21T21:00:00Z')], NOW).until).toBe(windowEnd);
  });
});

describe('createTtlCache', () => {
  it('reuses a value until its ttl passes', async () => {
    let now = 0;
    let loads = 0;
    const cache = createTtlCache<number>({ ttlMs: () => 1000, now: () => now });
    const load = async () => ++loads;
    expect([await cache.getOrLoad('k', load), await cache.getOrLoad('k', load)]).toEqual([1, 1]);
    now = 999;
    expect(await cache.getOrLoad('k', load)).toBe(1);
    now = 1000;
    expect(await cache.getOrLoad('k', load)).toBe(2);
  });

  it('shares one load between concurrent callers', async () => {
    let loads = 0;
    const cache = createTtlCache<number>({ ttlMs: () => 1000 });
    const load = async () => {
      await Promise.resolve();
      return ++loads;
    };
    expect(await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)])).toEqual([1, 1]);
  });

  it('does not cache a failed load', async () => {
    const cache = createTtlCache<number>({ ttlMs: () => 1000 });
    await expect(cache.getOrLoad('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await cache.getOrLoad('k', async () => 5)).toBe(5);
  });

  it('lets a value pick its own ttl and drops the oldest entries past the cap', () => {
    let now = 0;
    const cache = createTtlCache<number | undefined>({ ttlMs: (v) => (v === undefined ? 10 : 1000), now: () => now, maxEntries: 2 });
    cache.set('miss', undefined);
    now = 11;
    expect(cache.peek('miss')).toBeUndefined();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect([cache.peek('a'), cache.peek('b'), cache.peek('c')]).toEqual([undefined, { value: 2 }, { value: 3 }]);
  });
});
