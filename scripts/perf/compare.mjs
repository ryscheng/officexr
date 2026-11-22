#!/usr/bin/env node
/**
 * Compares perf-turn.json runs of a base and a head checkout taken on one machine.
 *   node scripts/perf/compare.mjs --base base-1.json base-2.json base-3.json --head head-1.json ...
 * Prints a markdown table (mode x metric, base vs head, % change) and, with --fail <pct>,
 * exits 1 when main-thread script ms per frame or React commits per second is worse by more than that
 * in two or more modes. Wall-clock fps is shown for information and never fails the check.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const METRICS = [
  ['scriptMsPerFrame', 'script ms/frame', 'lower', true],
  ['taskMsPerFrame', 'task ms/frame', 'lower', false],
  ['commitsPerSec', 'React commits/s', 'lower', true],
  ['drawCalls', 'draw calls', 'lower', false],
  ['triangles', 'triangles', 'lower', false],
  ['fps', 'fps (info)', 'higher', false],
];

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mergeRuns(runs) {
  const merged = {};
  for (const run of runs) {
    for (const [mode, stats] of Object.entries(run.modes)) {
      merged[mode] ??= {};
      for (const [key] of METRICS) (merged[mode][key] ??= []).push(stats[key]);
    }
  }
  return Object.fromEntries(
    Object.entries(merged).map(([mode, byKey]) => [mode, Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, median(v)]))]),
  );
}

const pctChange = (base, head) => (base === 0 ? (head === 0 ? 0 : Infinity) : ((head - base) / base) * 100);

export function compare(baseRuns, headRuns, failPct = 25) {
  const base = mergeRuns(baseRuns);
  const head = mergeRuns(headRuns);
  const rows = [];
  const regressedModes = [];
  for (const mode of Object.keys(base)) {
    if (!head[mode]) continue;
    let modeRegressed = false;
    for (const [key, label, better, gates] of METRICS) {
      const change = pctChange(base[mode][key], head[mode][key]);
      const worse = better === 'lower' ? change : -change;
      rows.push({ mode, key, label, base: base[mode][key], head: head[mode][key], change, worse });
      if (gates && worse > failPct) modeRegressed = true;
    }
    if (modeRegressed) regressedModes.push(mode);
  }
  return { rows, regressedModes, fail: regressedModes.length >= 2 };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function toMarkdown(result, runsPerSide, failPct = 25) {
  const lines = [
    `Median of ${runsPerSide} runs per side, production build, one machine, software WebGL: read the % change, not the absolute values.`,
    '',
    '| Mode | Metric | Base | Head | Change |',
    '|---|---|---:|---:|---:|',
  ];
  for (const r of result.rows) {
    const mark = r.worse > failPct ? ' (worse)' : r.worse > 10 ? ' (warn)' : '';
    const change = Number.isFinite(r.change) ? `${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%` : 'n/a';
    lines.push(`| ${r.mode} | ${r.label} | ${fmt(r.base)} | ${fmt(r.head)} | ${change}${mark} |`);
  }
  lines.push('');
  lines.push(
    result.fail
      ? `**Fail:** script ms/frame or React commits/s is more than ${failPct}% worse in ${result.regressedModes.join(', ')}.`
      : result.regressedModes.length
        ? `Warning: script ms/frame or React commits/s is more than ${failPct}% worse in ${result.regressedModes.join(', ')}; the check fails at two modes.`
        : 'No CPU or React commit regression beyond the threshold.',
  );
  return lines.join('\n');
}

function main(argv) {
  const base = [];
  const head = [];
  let target = base;
  let failPct = 25;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') target = base;
    else if (argv[i] === '--head') target = head;
    else if (argv[i] === '--fail') failPct = Number(argv[++i]);
    else target.push(JSON.parse(readFileSync(argv[i], 'utf8')));
  }
  const result = compare(base, head, failPct);
  console.log(toMarkdown(result, Math.min(base.length, head.length), failPct));
  process.exit(result.fail ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
