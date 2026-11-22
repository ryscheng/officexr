#!/usr/bin/env node
/**
 * Prints a trend table of the nightly perf runs: node scripts/perf/trend.mjs [N]   (default 14)
 * Needs the gh CLI signed in to the repo. Downloads the last N unexpired perf-nightly artifacts to a temp dir.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function trendTable(runs) {
  const modes = [...new Set(runs.flatMap((r) => Object.keys(r.modes)))];
  const header = ['Date', 'Commit', ...modes.flatMap((m) => [`${m} script ms/frame`, `${m} commits/s`])];
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const r of runs) {
    const cells = modes.flatMap((m) => [r.modes[m]?.scriptMsPerFrame ?? '', r.modes[m]?.commitsPerSec ?? '']);
    lines.push(`| ${[(r.date ?? '').slice(0, 10), (r.commit ?? '').slice(0, 7), ...cells].join(' | ')} |`);
  }
  return lines.join('\n');
}

function main() {
  const n = Number(process.argv[2] ?? 14);
  const jq = '.artifacts[] | select(.name | startswith("perf-nightly-")) | select(.expired | not) | {name, created_at, run: .workflow_run.id}';
  const found = execFileSync('gh', ['api', '--paginate', 'repos/{owner}/{repo}/actions/artifacts?per_page=100', '--jq', jq], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-n);
  const dir = mkdtempSync(path.join(tmpdir(), 'perf-trend-'));
  const runs = found.map((a) => {
    const target = path.join(dir, a.name);
    execFileSync('gh', ['run', 'download', String(a.run), '--name', a.name, '--dir', target], { stdio: 'ignore' });
    return JSON.parse(readFileSync(path.join(target, 'perf-nightly.json'), 'utf8'));
  });
  console.log(trendTable(runs));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
