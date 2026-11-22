import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, median, toMarkdown } from './compare.mjs';

const stats = (scriptMsPerFrame, commitsPerSec = 10) => ({ scriptMsPerFrame, taskMsPerFrame: 20, commitsPerSec, fps: 30, drawCalls: 100, triangles: 1000 });
const run = (scriptByMode) => ({ modes: Object.fromEntries(Object.entries(scriptByMode).map(([m, ms]) => [m, stats(ms)])) });

test('median of an even and odd count', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('fails only when two modes are over the threshold', () => {
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

test('more React commits per second count as a regression', () => {
  const base = [{ modes: { a: stats(20, 10), b: stats(20, 10) } }];
  const head = [{ modes: { a: stats(20, 14), b: stats(20, 14) } }];
  assert.equal(compare(base, head).fail, true);
});

test('a mode with both gates over the line counts once', () => {
  const base = [{ modes: { a: stats(20, 10), b: stats(20, 10) } }];
  const head = [{ modes: { a: stats(40, 40), b: stats(20, 10) } }];
  assert.deepEqual(compare(base, head).regressedModes, ['a']);
  assert.equal(compare(base, head).fail, false);
});

test('a higher fps is not a regression and fps never fails the check', () => {
  const base = [run({ a: 20 })];
  const head = [{ modes: { a: { ...stats(20), fps: 60 } } }];
  const row = compare(base, head).rows.find((r) => r.key === 'fps');
  assert.ok(row.worse < 0);
  const slow = [{ modes: { a: { ...stats(20), fps: 1 } } }];
  assert.equal(compare(base, slow).regressedModes.length, 0);
  assert.match(toMarkdown(compare(base, head), 1), /fps \(info\)/);
});

test('trend table has one row per run', async () => {
  const { trendTable } = await import('./trend.mjs');
  const table = trendTable([
    { date: '2026-11-20T03:00Z', commit: 'abcdef123', modes: { angled: { scriptMsPerFrame: 20, commitsPerSec: 2 } } },
    { date: '2026-11-21T03:00Z', commit: '1234567ff', modes: { angled: { scriptMsPerFrame: 22, commitsPerSec: 3 } } },
  ]);
  assert.equal(table.split('\n').length, 4);
  assert.match(table, /2026-11-21 \| 1234567 \| 22 \| 3/);
});
