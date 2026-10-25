#!/usr/bin/env tsx
/**
 * Headless layout bake script.
 *
 * Usage:
 *   pnpm tsx packages/world/scripts/bake-layout.ts <layoutName>
 *   pnpm tsx packages/world/scripts/bake-layout.ts --all
 *
 * Reads layout JSON from `packages/world/layouts/<name>.json`. Writes the baked GLB to
 * `packages/world/baked-layouts/<name>.glb`.
 *
 * Exits 0 on success, 1 on any failure.
 *
 * Prerequisites:
 * - Kind GLTFs must be present under `packages/studio/public/` (downloaded via
 *   `pnpm asset-packs:install`).
 *
 * Path assumptions:
 * - `kind.gltfPath` starts with `/models/...` (as stored in the catalog).
 *   The script strips the leading `/` and resolves against the studio public
 *   dir: `<root>/packages/studio/public/<gltfPath>`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeLayoutGlb } from '../src/app/bake-layout-glb.ts';
import { deserializeLayout } from '../src/scenes/layout-document.ts';

// ---------------------------------------------------------------------------
// Path setup
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, '..');
const STUDIO_PUBLIC = path.resolve(WORLD_ROOT, '../../packages/studio/public');
const LAYOUTS_DIR = path.resolve(WORLD_ROOT, 'layouts');
const BAKED_DIR = path.resolve(WORLD_ROOT, 'baked-layouts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadLayout(name: string) {
  const filePath = path.resolve(LAYOUTS_DIR, `${name}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Layout "${name}" not found at ${filePath}`);
  }
  return deserializeLayout(JSON.parse(raw) as unknown);
}

async function ensureBakedDir(): Promise<void> {
  await fs.mkdir(BAKED_DIR, { recursive: true });
}

async function bakeOne(name: string, optimizerOverride?: string): Promise<void> {
  console.log(`[bake-layout] Baking layout "${name}"…`);
  const layout = await loadLayout(name);
  const result = await bakeLayoutGlb({ layout, modelRoot: STUDIO_PUBLIC, optimizer: optimizerOverride });
  const outPath = path.resolve(BAKED_DIR, `${name}.glb`);
  await fs.writeFile(outPath, result.glb);
  console.log(
    `[bake-layout] ✓ "${name}" → ${outPath} (${result.glb.length} bytes, ` +
    `${result.meta.commandCount} commands, ${result.meta.kindCount} kinds, ` +
    `optimizer=${result.meta.optimizerId})`,
  );
}

async function listLayouts(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(LAYOUTS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  // Parse `--optimizer=<id>` or `--optimizer <id>`. Empty string is treated
  // as "use the layout's stored choice" (i.e. no override).
  let optimizerOverride: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--optimizer' && i + 1 < args.length) {
      optimizerOverride = args[i + 1];
      i++;
    } else if (a.startsWith('--optimizer=')) {
      optimizerOverride = a.slice('--optimizer='.length);
    }
  }
  const names = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      // skip the value that follows `--optimizer` (space form)
      args[i - 1] !== '--optimizer',
  );

  if (!allFlag && names.length === 0) {
    console.error(
      'Usage: bake-layout <layoutName> [<layoutName>…] | --all [--optimizer <id>]',
    );
    process.exit(1);
  }

  await ensureBakedDir();

  let targets: string[];
  if (allFlag) {
    targets = await listLayouts();
    if (targets.length === 0) {
      console.warn('[bake-layout] No layouts found in', LAYOUTS_DIR);
      process.exit(0);
    }
    console.log(`[bake-layout] Baking all ${targets.length} layout(s): ${targets.join(', ')}`);
  } else {
    targets = names;
  }

  let failed = 0;
  for (const name of targets) {
    try {
      await bakeOne(name, optimizerOverride);
    } catch (err) {
      console.error(`[bake-layout] ✗ Failed to bake "${name}":`, (err as Error).message);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`[bake-layout] ${failed} layout(s) failed.`);
    process.exit(1);
  }

  console.log('[bake-layout] Done.');
}

main().catch((err) => {
  console.error('[bake-layout]', err);
  process.exit(1);
});
