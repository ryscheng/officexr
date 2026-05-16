#!/usr/bin/env node
/**
 * CI gate: editor canvases must compose renderer primitives from
 * `@officexr/world/renderer`, not re-implement them.
 *
 * Two categories are flagged across the full source tree:
 *
 *   1. `SEAM_OVERLAP` anywhere — the constant is decommissioned and
 *      no code path should set a scale ≠ `kind.scale`. Comments and
 *      strings that document the history (e.g. ObjectInstances'
 *      explanation of why it was removed) are in the exempt list.
 *   2. Inline lights — `<directionalLight`, `<hemisphereLight`,
 *      `<ambientLight`, `<spotLight`, `<pointLight` — anywhere
 *      outside `packages/world/src/renderer/`. Editors mount
 *      `<LightingRig>` from the renderer package instead.
 *
 * BoxGeometry is intentionally NOT linted: editors legitimately
 * use it for selection-outline edge geometry, the renderer's own
 * `__primitive_*` diagnostic mode constructs it, and legacy
 * `packages/core` code uses it for non-cube objects (desks, chairs).
 * The SEAM_OVERLAP rule above already catches any future cube
 * renderer that re-introduces the inflation bug.
 *
 * On failure, prints every offending file:line and exits non-zero.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGES_DIR = resolve(__dirname, '../../');

const RULES = [
  {
    name: 'SEAM_OVERLAP (decommissioned — use kind.scale exactly)',
    pattern: 'SEAM_OVERLAP',
    excludePaths: [
      // ObjectInstances.tsx documents WHY SEAM_OVERLAP was removed;
      // those history comments are intentional.
      'packages/world/src/renderer/ObjectInstances.tsx',
      // The lint script itself mentions the name.
      'packages/studio/scripts/lint-no-bespoke-renderer.js',
    ],
  },
  {
    name: 'inline <directionalLight> (use <LightingRig>)',
    pattern: '<directionalLight',
    excludeFullPaths: ['packages/world/src/renderer/'],
  },
  {
    name: 'inline <hemisphereLight> (use <LightingRig>)',
    pattern: '<hemisphereLight',
    excludeFullPaths: ['packages/world/src/renderer/'],
  },
  {
    name: 'inline <ambientLight> (use <LightingRig>)',
    pattern: '<ambientLight',
    excludeFullPaths: ['packages/world/src/renderer/'],
  },
  {
    name: 'inline <spotLight> (use <LightingRig>)',
    pattern: '<spotLight',
    excludeFullPaths: ['packages/world/src/renderer/'],
  },
  {
    name: 'inline <pointLight> (use <LightingRig>)',
    pattern: '<pointLight',
    excludeFullPaths: ['packages/world/src/renderer/'],
  },
];

let leaked = '';

for (const rule of RULES) {
  const args = [
    '-rEn',
    rule.pattern,
    PACKAGES_DIR,
    '--include=*.ts',
    '--include=*.tsx',
    '--exclude-dir=node_modules',
    '--exclude-dir=dist',
    '--exclude-dir=.vite',
  ];
  let out = '';
  try {
    out = execFileSync('grep', args, { encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) continue; // no matches
    console.error(`[lint:no-bespoke-renderer] grep failed for "${rule.name}":`, err.message);
    process.exit(2);
  }
  const lines = out.split('\n').filter((line) => {
    if (!line) return false;
    for (const path of rule.excludePaths ?? []) {
      if (line.includes(path)) return false;
    }
    for (const full of rule.excludeFullPaths ?? []) {
      if (line.includes(full)) return false;
    }
    return true;
  });
  if (lines.length > 0) {
    leaked += `\n=== ${rule.name} ===\n` + lines.join('\n') + '\n';
  }
}

if (leaked.trim()) {
  console.error(
    'Editor canvases must use renderer primitives, not bespoke implementations:',
  );
  console.error(leaked);
  console.error(
    '\nFix: import from `@officexr/world/renderer` — <ObjectInstances>,',
  );
  console.error('<LightingRig>, <EditorCamera>, etc. See `CLAUDE.md`.');
  process.exit(1);
}
console.log(
  'grep gate clean — no bespoke lighting / SEAM_OVERLAP outside renderer.',
);
