import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, median, toMarkdown } from './compare.mjs';

const run = (p95ByMode) => ({
  modes: Object.fromEntries(Object.entries(p95ByMode).map(([m, p95]) => [m, { p50: 16, p95, low1Fps: 30, stalls: 1, drawCalls: 100, triangles: 1000 }])),
});

test('median of an even and odd count', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('fails only when two modes are over the p95 threshold', () => {
  const base = [run({ a: 20, b: 20, c: 20 })];
  assert.equal(compare(base, [run({ a: 30, b: 20, c: 20 })]).fail, false);
  assert.equal(compare(base, [run({ a: 30, b: 30, c: 20 })]).fail, true);
  assert.deepEqual(compare(base, [run({ a: 30, b: 30, c: 20 })]).regressedModes, ['a', 'b']);
});

test('uses the median across runs so one noisy run does not fail', () => {
  const base = [run({ a: 20, b: 20 }), run({ a: 20, b: 20 }), run({ a: 20, b: 20 })];
  const head = [run({ a: 60, b: 60 }), run({ a: 20, b: 20 }), run({ a: 21, b: 21 })];
  assert.equal(compare(base, head).fail, false);
});

test('a higher 1% low fps is not a regression', () => {
  const base = [run({ a: 20 })];
  const head = [{ modes: { a: { ...run({ a: 20 }).modes.a, low1Fps: 60 } } }];
  const row = compare(base, head).rows.find((r) => r.key === 'low1Fps');
  assert.ok(row.worse < 0);
  assert.match(toMarkdown(compare(base, head), 1), /1% low fps/);
});

test('trend table has one row per run', async () => {
  const { trendTable } = await import('./trend.mjs');
  const table = trendTable([
    { date: '2026-11-20T03:00Z', commit: 'abcdef123', modes: { angled: { p95: 20, stalls: 2 } } },
    { date: '2026-11-21T03:00Z', commit: '1234567ff', modes: { angled: { p95: 22, stalls: 3 } } },
  ]);
  assert.equal(table.split('\n').length, 4);
  assert.match(table, /2026-11-21 \| 1234567 \| 22 \| 3/);
});
