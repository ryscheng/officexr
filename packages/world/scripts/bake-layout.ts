#!/usr/bin/env tsx
/**
 * Headless layout bake script.
 *
 * Usage:
 *   pnpm tsx packages/world/scripts/bake-layout.ts <layoutName>
 *   pnpm tsx packages/world/scripts/bake-layout.ts --all
 *
 * Reads the world-object catalog from `packages/world/world-object-kinds.json`
 * (falls back to `.default.json` if missing). Reads layout JSON from
 * `packages/world/layouts/<name>.json`. Writes the baked GLB to
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
import { NodeIO } from '@gltf-transform/core';
import { bakeLayout } from '../src/app/layout-bake-service.ts';
import { createInstanceGeometry } from '../src/app/geometry-service.ts';
import { deserializeLayout } from '../src/scenes/layout-document.ts';
import { validateWorldObjectKindCatalog, normalizeKind } from '../src/scenes/world-object-kinds-schema.ts';
import type { WorldObjectKind } from '../src/scenes/world-object-kinds-schema.ts';

// Voxel size matches the v4+ runtime convention. Source of truth lives
// in the application layer (`createDefaultApi` passes this to the
// geometry service); duplicated here only because the CLI bootstraps
// the service directly without going through the full API factory.
const VOXEL_SIZE = 0.5;

// Used by `gltfLoader` below: NodeIO auto-detects .gltf vs .glb and
// resolves external .bin / image resources, so the kind catalog can
// keep referencing JSON .gltf assets like KayKit's bundles. We then
// re-emit each source as a GLB byte stream so the bake service's
// `readBinary` path consumes them uniformly.
const io = new NodeIO();

// ---------------------------------------------------------------------------
// Path setup
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, '..');
const STUDIO_PUBLIC = path.resolve(WORLD_ROOT, '../../packages/studio/public');
const LAYOUTS_DIR = path.resolve(WORLD_ROOT, 'layouts');
const BAKED_DIR = path.resolve(WORLD_ROOT, 'baked-layouts');
const CATALOG_PATH = path.resolve(WORLD_ROOT, 'world-object-kinds.json');
const CATALOG_DEFAULT_PATH = path.resolve(WORLD_ROOT, 'world-object-kinds.default.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadCatalog(): Promise<Map<string, WorldObjectKind>> {
  let raw: string;
  try {
    raw = await fs.readFile(CATALOG_PATH, 'utf-8');
  } catch {
    raw = await fs.readFile(CATALOG_DEFAULT_PATH, 'utf-8');
  }
  const parsed = JSON.parse(raw) as unknown;
  const catalog = validateWorldObjectKindCatalog(parsed);
  const map = new Map<string, WorldObjectKind>();
  for (const [idx, kind] of catalog.kinds.entries()) {
    map.set(kind.id, normalizeKind(kind, idx));
  }
  return map;
}

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

async function gltfLoader(url: string): Promise<Uint8Array> {
  // url looks like /models/blocks/bricks_A.gltf — strip the leading '/'
  const rel = url.startsWith('/') ? url.slice(1) : url;
  const absPath = path.resolve(STUDIO_PUBLIC, rel);
  // NodeIO.read() auto-detects JSON .gltf vs binary .glb and resolves
  // external resources relative to the file. writeBinary() then re-emits
  // a self-contained GLB the bake service can consume via readBinary.
  const doc = await io.read(absPath);
  return await io.writeBinary(doc);
}

async function ensureBakedDir(): Promise<void> {
  await fs.mkdir(BAKED_DIR, { recursive: true });
}

async function bakeOne(
  name: string,
  kindMap: Map<string, WorldObjectKind>,
  optimizerOverride?: string,
): Promise<void> {
  console.log(`[bake-layout] Baking layout "${name}"…`);
  const doc = await loadLayout(name);

  // Build the canonical geometry service from the same catalog. The
  // bake service uses geometry.meshOrigin(position, kindId) to translate
  // each kind's mesh root, so the baked GLB matches the runtime renderer
  // pixel-for-pixel.
  const geometry = createInstanceGeometry({
    catalog: {
      getKind: (id: string) => kindMap.get(id),
    },
    voxelSize: VOXEL_SIZE,
  });

  // CLI flag overrides the layout's stored optimizer choice. Useful for
  // experimenting with strategies without rewriting the layout JSON.
  const optimizer = optimizerOverride ?? doc.optimizer;

  const result = await bakeLayout(
    doc,
    (id) => kindMap.get(id),
    gltfLoader,
    geometry,
    { optimizer },
  );
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

  const kindMap = await loadCatalog();
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
      await bakeOne(name, kindMap, optimizerOverride);
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
