import { describe, expect, it } from 'vitest';
import type { HintName } from '../hintFlags';
import { HINT_DELAY_MS, HINT_GAP_MS, HINT_SHOW_MS, planHint, type PlanInput } from './hintPlan';

const none: Record<HintName, boolean> = { wave: false, people: false, move: false, alone: false, build: false };
const input = (over: Partial<PlanInput>): PlanInput => ({
  now: 100_000,
  active: null,
  lastEndedAt: null,
  conditions: none,
  since: {},
  isAvailable: () => true,
  ...over,
});

describe('planHint', () => {
  it('shows nothing before a hint has waited its delay', () => {
    const since = { move: 100_000 - HINT_DELAY_MS.move + 1 };
    expect(planHint(input({ conditions: { ...none, move: true }, since }))).toBeNull();
    expect(planHint(input({ conditions: { ...none, move: true }, since: { move: 100_000 - HINT_DELAY_MS.move } }))?.name).toBe('move');
  });

  it('shows one hint at a time, in priority order', () => {
    const waited = { wave: 0, people: 0, move: 0, alone: 0 };
    const all = { ...none, wave: true, people: true, move: true, alone: true };
    expect(planHint(input({ conditions: all, since: waited }))?.name).toBe('wave');
    expect(planHint(input({ conditions: { ...all, wave: false }, since: waited }))?.name).toBe('people');
    expect(planHint(input({ conditions: { ...all, wave: false, people: false }, since: waited }))?.name).toBe('move');
  });

  it('keeps the running hint when a higher one becomes ready', () => {
    const running = { name: 'move' as const, at: 95_000 };
    const next = planHint(input({ active: running, conditions: { ...none, move: true, wave: true }, since: { move: 0, wave: 0 } }));
    expect(next).toBe(running);
  });

  it('ends a hint after 12 seconds', () => {
    const conditions = { ...none, move: true };
    expect(planHint(input({ active: { name: 'move', at: 100_000 - HINT_SHOW_MS + 1 }, conditions }))?.name).toBe('move');
    expect(planHint(input({ active: { name: 'move', at: 100_000 - HINT_SHOW_MS }, conditions }))).toBeNull();
  });

  it('ends a hint when its condition stops holding', () => {
    expect(planHint(input({ active: { name: 'wave', at: 99_000 }, conditions: none }))).toBeNull();
  });

  it('waits a short gap between two hints', () => {
    const base = { conditions: { ...none, people: true }, since: { people: 0 } };
    expect(planHint(input({ ...base, lastEndedAt: 100_000 - HINT_GAP_MS + 1 }))).toBeNull();
    expect(planHint(input({ ...base, lastEndedAt: 100_000 - HINT_GAP_MS }))?.name).toBe('people');
  });

  it('skips a hint that is no longer available', () => {
    const conditions = { ...none, wave: true, people: true };
    const next = planHint(input({ conditions, since: { wave: 0, people: 0 }, isAvailable: (n) => n !== 'wave' }));
    expect(next?.name).toBe('people');
  });

  it('shows the build hint at once', () => {
    expect(planHint(input({ conditions: { ...none, build: true }, since: { build: 100_000 } }))?.name).toBe('build');
  });
});
