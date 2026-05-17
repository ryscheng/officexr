#!/usr/bin/env tsx
/**
 * One-shot installer for the three KayKit FREE asset packs the studio's
 * Object editor and Room editor use as their non-cube catalog. The
 * binary GLTF files are gitignored (see `.gitignore`) — devs run this
 * script once after cloning to populate them locally.
 *
 * The catalog entries that reference these files live in
 * `packages/world/cube-kinds.json`, which IS committed. So a fresh
 * clone has the catalog metadata (label / swatch / category / etc.)
 * but no binaries until this script runs; the renderer's `useGLTF`
 * will 404 on any kind whose binaries are missing.
 *
 * Idempotent: if a pack's target directory already contains files,
 * the download + unzip is skipped. Pass `--force` to redownload.
 *
 * Requires `unzip` on $PATH (built-in on macOS / Linux / WSL / git
 * bash on Windows).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldObjectKindCatalog } from '../src/scenes/world-object-kinds-schema.ts';
import type {
  WorldObjectKindCatalogV1,
  CubeKindCategory,
  WorldObjectKind,
} from '../src/scenes/world-object-kinds-schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = join(__dirname, '..');
const STUDIO_PUBLIC = join(WORLD_ROOT, '..', 'studio', 'public');
const MODELS_DIR = join(STUDIO_PUBLIC, 'models');
const CATALOG_FILE = join(WORLD_ROOT, 'world-object-kinds.json');

const FORCE = process.argv.includes('--force');

interface PackSpec {
  id: CubeKindCategory;
  url: string;
  /** CSS hex used as the palette swatch for this pack's entries. */
  swatch: string;
}

const PACKS: PackSpec[] = [
  {
    id: 'furniture',
    url: 'https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Furniture_Bits_1.0_FREE.zip',
    swatch: '#a16207',
  },
  {
    id: 'prototype',
    url: 'https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Prototype_Bits_1.1_FREE.zip',
    swatch: '#7c3aed',
  },
  {
    id: 'restaurant',
    url: 'https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Restaurant_Bits_1.0_FREE.zip',
    swatch: '#dc2626',
  },
];

async function downloadFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
}

async function dirHasFiles(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir);
  return entries.length > 0;
}

async function installPack(pack: PackSpec): Promise<void> {
  const targetDir = join(MODELS_DIR, pack.id);
  if (await dirHasFiles(targetDir)) {
    if (!FORCE) {
      console.log(`[asset-packs] ${pack.id}: already installed (use --force to redownload)`);
      return;
    }
    console.log(`[asset-packs] ${pack.id}: --force given, removing existing files`);
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(targetDir, { recursive: true });
  const tmpZip = join(tmpdir(), `officexr-${pack.id}-${Date.now()}.zip`);
  console.log(`[asset-packs] ${pack.id}: downloading ${pack.url}`);
  await downloadFile(pack.url, tmpZip);
  console.log(`[asset-packs] ${pack.id}: unzipping to ${targetDir}`);
  // -o overwrite, -q quiet, -d dest
  execSync(`unzip -o -q "${tmpZip}" -d "${targetDir}"`, { stdio: 'inherit' });
  await rm(tmpZip, { force: true });
}

async function findGltfs(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith('.gltf')) {
        out.push(full);
      }
    }
  }
  if (existsSync(root)) await walk(root);
  return out;
}

function slugify(name: string): string {
  return name
    .replace(/\.gltf$/i, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function humanize(name: string): string {
  return name
    .replace(/\.gltf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function entryForGltf(
  packId: CubeKindCategory,
  gltfAbsPath: string,
  swatch: string,
): WorldObjectKind {
  const rel = relative(STUDIO_PUBLIC, gltfAbsPath).replace(/\\/g, '/');
  const basename = gltfAbsPath.split(/[\\/]/).pop() ?? '';
  return {
    id: `${packId}_${slugify(basename)}`,
    label: humanize(basename),
    gltfPath: '/' + rel,
    swatch,
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: packId,
    tilingAxes: { x: packId === 'block', y: packId === 'block', z: packId === 'block' },
    gravity: false,
    optimization: 'none' as const,
  };
}

async function loadCatalog(): Promise<WorldObjectKindCatalogV1> {
  const raw = await readFile(CATALOG_FILE, 'utf8');
  return validateWorldObjectKindCatalog(JSON.parse(raw));
}

async function writeCatalog(catalog: WorldObjectKindCatalogV1): Promise<void> {
  await writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

async function main(): Promise<void> {
  await mkdir(MODELS_DIR, { recursive: true });

  for (const pack of PACKS) {
    await installPack(pack);
  }

  console.log('[asset-packs] enumerating .gltf files and updating catalog...');
  const catalog = await loadCatalog();
  const existingIds = new Set(catalog.kinds.map((k) => k.id));
  let added = 0;
  for (const pack of PACKS) {
    const dir = join(MODELS_DIR, pack.id);
    const gltfs = await findGltfs(dir);
    for (const gltf of gltfs) {
      const entry = entryForGltf(pack.id, gltf, pack.swatch);
      if (existingIds.has(entry.id)) continue;
      catalog.kinds.push(entry);
      existingIds.add(entry.id);
      added++;
    }
  }
  if (added > 0) {
    catalog.updatedAt = Date.now();
    await writeCatalog(catalog);
  }
  console.log(
    `[asset-packs] done — added ${added} new catalog entries (total: ${catalog.kinds.length})`,
  );
}

main().catch((err: unknown) => {
  console.error('[asset-packs] failed:', err);
  process.exit(1);
});
