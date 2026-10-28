#!/usr/bin/env tsx
/**
 * Headless layout bake script.
 *
 * Usage:
 *   pnpm tsx packages/world/scripts/bake-layout.ts <layoutName>
 *   pnpm tsx packages/world/scripts/bake-layout.ts --all
 *   pnpm tsx packages/world/scripts/bake-layout.ts --map <mapName>
 *
 * Reads layout JSON from `packages/world/layouts/<name>.json`. `--map` bakes every layout the rooms of
 * `packages/world/maps/<mapName>.json` use (rooms come from `packages/world/rooms/`). Writes the baked GLB to
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
import { groupPlacementsByLayout, mapLayoutPlacements } from '../src/scenes/map-layout-placements.ts';
import { deserializeMap, deserializeScene, migrateToV5 } from '../src/scenes/serialize.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, '..');
const STUDIO_PUBLIC = path.resolve(WORLD_ROOT, '../../packages/studio/public');
const LAYOUTS_DIR = path.resolve(WORLD_ROOT, 'layouts');
const MAPS_DIR = path.resolve(WORLD_ROOT, 'maps');
const ROOMS_DIR = path.resolve(WORLD_ROOT, 'rooms');
const BAKED_DIR = path.resolve(WORLD_ROOT, 'baked-layouts');

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

/** Parsed JSON, or null when the file does not exist; unreadable or malformed files throw. */
async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function layoutsOfMap(mapName: string): Promise<{ layouts: string[]; missingRooms: string[] }> {
  const mapPath = path.resolve(MAPS_DIR, `${mapName}.json`);
  const rawMap = await readJsonIfExists(mapPath);
  if (rawMap === null) {
    throw new Error(`Map "${mapName}" not found at ${mapPath}`);
  }
  const { placements, missingRooms } = await mapLayoutPlacements(deserializeMap(rawMap), async (name) => {
    const raw = await readJsonIfExists(path.resolve(ROOMS_DIR, `${name}.json`));
    return raw === null ? null : migrateToV5(deserializeScene(raw));
  });
  return { layouts: [...groupPlacementsByLayout(placements).keys()], missingRooms };
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
    `${result.meta.commandCount} commands → ${result.meta.instanceCount} instances, ` +
    `${result.meta.kindCount} kinds, ` +
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  // Parse `--optimizer=<id>` or `--optimizer <id>`. Empty string is treated
  // as "use the layout's stored choice" (i.e. no override).
  let optimizerOverride: string | undefined;
  let mapName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--optimizer' && i + 1 < args.length) {
      optimizerOverride = args[i + 1];
      i++;
    } else if (a.startsWith('--optimizer=')) {
      optimizerOverride = a.slice('--optimizer='.length);
    } else if (a === '--map' && i + 1 < args.length) {
      mapName = args[i + 1];
      i++;
    } else if (a.startsWith('--map=')) {
      mapName = a.slice('--map='.length);
    }
  }
  const names = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      // skip the value that follows `--optimizer` or `--map` (space form)
      args[i - 1] !== '--optimizer' &&
      args[i - 1] !== '--map',
  );

  if (args.some((a) => a === '--map' || a.startsWith('--map=')) && (!mapName || mapName.startsWith('--'))) {
    console.error('[bake-layout] --map needs a map name');
    process.exit(1);
  }
  if (mapName !== undefined && (allFlag || names.length > 0)) {
    console.error('[bake-layout] --map cannot be combined with --all or layout names');
    process.exit(1);
  }

  if (!allFlag && mapName === undefined && names.length === 0) {
    console.error(
      'Usage: bake-layout <layoutName> [<layoutName>…] | --all | --map <mapName> [--optimizer <id>]',
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
  } else if (mapName !== undefined) {
    const { layouts, missingRooms } = await layoutsOfMap(mapName);
    if (missingRooms.length > 0) {
      console.error(`[bake-layout] Map "${mapName}" rooms not found or unreadable: ${missingRooms.join(', ')}`);
      process.exit(1);
    }
    targets = layouts;
    console.log(`[bake-layout] Baking ${targets.length} layout(s) of map "${mapName}": ${targets.join(', ')}`);
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
