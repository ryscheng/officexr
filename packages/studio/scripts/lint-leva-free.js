#!/usr/bin/env node
/**
 * CI gate: fail if any Leva references sneak back into the codebase.
 *
 * Runs four greps against ../../packages and exits non-zero if any
 * match. The patterns cover:
 *   - `from 'leva'` / `from "leva"` — direct imports
 *   - `useControls`              — the Leva hook name
 *   - `levaPersistence`          — the deleted persistence module
 *   - `levaStore`                — the global Leva zustand store
 *
 * Matches in this file itself (the script) are ignored.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGES_DIR = resolve(__dirname, '../../');

const PATTERNS = [
  "from ['\"]leva['\"]",
  'useControls',
  'levaPersistence',
  'levaStore',
];

let leaked = '';
for (const pattern of PATTERNS) {
  try {
    // Pass argv as an array so the shell doesn't reinterpret our
    // grep regex (the single+double quote pattern would otherwise be
    // mangled by /bin/sh).
    const out = execFileSync(
      'grep',
      [
        '-rEn',
        pattern,
        PACKAGES_DIR,
        '--include=*.ts',
        '--include=*.tsx',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
      ],
      { encoding: 'utf8' },
    );
    // grep returns 0 with output on match; if it had no match, it
    // would return 1 and we'd land in the catch below.
    // Filter out this script's own filename so it doesn't self-match.
    const filtered = out
      .split('\n')
      .filter((line) => line && !line.includes('lint-leva-free.js'))
      .join('\n');
    if (filtered) leaked += filtered + '\n';
  } catch (err) {
    // grep returns 1 when there are no matches — that's the happy path.
    if (err.status !== 1) {
      console.error('[lint:leva-free] grep failed unexpectedly:', err.message);
      process.exit(2);
    }
  }
}

if (leaked.trim()) {
  console.error('Leva references still present:');
  console.error(leaked);
  process.exit(1);
}
console.log('grep gate clean — no Leva references found');
