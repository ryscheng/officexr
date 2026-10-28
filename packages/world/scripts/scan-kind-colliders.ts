/**
 * Collider scanner CLI — derives collider geometry for catalog kinds by
 * scanning their actual GLB meshes, and writes the result into
 * `world-object-kinds.json` as a `colliderShape` override.
 *
 *   pnpm --filter @officexr/world scan:colliders -- --all
 *   pnpm --filter @officexr/world scan:colliders -- \
 *     [--mode=cuboids|trimesh] [--cell=0.125] [--eps=0.01] <kindId> [<kindId> ...]
 *
 * `--all` regenerates `colliderShape` for every kind that carries a
 * `colliderComplexity` recipe (the authoring-time record of how its shape
 * is produced). Recipe types:
 *   box         — removes any `colliderShape` (runtime falls back to the AABB).
 *   heightfield — `scanColliderCuboids` (XZ heightfield; stairs and
 *                 stair-like solids) using the recipe's `cellSize` /
 *                 `heightEpsilon`. See `src/app/collider-scan.ts`.
 *   trimesh     — `scanColliderTrimesh` (slopes).
 *   profile     — not implemented yet; the CLI errors.
 * `--all` cannot be combined with explicit kind ids.
 *
 * With explicit kind ids, `--mode` picks the scan per invocation:
 * cuboids (default, same as a heightfield recipe) or trimesh.
 *
 * The script prints a review table (triangles in, cuboids out, step
 * tops in metres) — READ IT before committing the catalog change; the
 * scanner is deterministic but garbage-in geometry produces
 * garbage-out colliders.
 *
 * Same authoring-pipeline role as `bake-kind-dimensions.ts` (which
 * writes scanned dimensions/localAABB): scanners write CATALOG data so
 * all three collider consumers (baked extras, MapColliders, bots) pick
 * it up through the shared `worldObjectsToCuboids` plumbing.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import {
  scanColliderCuboids,
  scanColliderTrimesh,
} from '../src/app/collider-scan.ts';
import {
  normalizeKind,
  type ColliderComplexity,
  type ColliderShapeSpec,
  validateWorldObjectKindCatalog,
} from '../src/scenes/world-object-kinds-schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, '..');
const STUDIO_PUBLIC = path.resolve(WORLD_ROOT, '../../packages/studio/public');
const CATALOG_PATH = path.resolve(WORLD_ROOT, 'world-object-kinds.json');

const io = new NodeIO();

interface CliArgs {
  mode?: 'cuboids' | 'trimesh';
  all: boolean;
  cellSize?: number;
  heightEpsilon?: number;
  kindIds: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { all: false, kindIds: [] };
  for (const a of argv) {
    if (a === '--') continue; // pnpm passes the arg separator through
    if (a === '--all') {
      args.all = true;
    } else if (a.startsWith('--mode=')) {
      const m = a.slice('--mode='.length);
      if (m !== 'cuboids' && m !== 'trimesh') {
        throw new Error(`unknown --mode "${m}" (cuboids | trimesh)`);
      }
      args.mode = m;
    } else if (a.startsWith('--cell=')) {
      args.cellSize = Number(a.slice('--cell='.length));
    } else if (a.startsWith('--eps=')) {
      args.heightEpsilon = Number(a.slice('--eps='.length));
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag "${a}"`);
    } else {
      args.kindIds.push(a);
    }
  }
  if (args.cellSize !== undefined && (!Number.isFinite(args.cellSize) || args.cellSize <= 0)) {
    throw new Error('--cell must be a positive number (metres)');
  }
  if (
    args.heightEpsilon !== undefined &&
    (!Number.isFinite(args.heightEpsilon) || args.heightEpsilon <= 0)
  ) {
    throw new Error('--eps must be a positive number (metres)');
  }
  if (args.all && args.kindIds.length > 0) {
    throw new Error('--all cannot be combined with explicit kind ids');
  }
  if (
    args.all &&
    (args.mode !== undefined || args.cellSize !== undefined || args.heightEpsilon !== undefined)
  ) {
    throw new Error('--all takes its settings from each recipe; --mode/--cell/--eps are not allowed');
  }
  if (!args.all && args.kindIds.length === 0) {
    throw new Error(
      'usage: scan-kind-colliders --all | [--mode=cuboids|trimesh] [--cell=0.125] [--eps=0.01] <kindId> ...',
    );
  }
  return args;
}

/** Round to 6 decimals — keeps the catalog diff stable and readable
 * without losing meaningful precision (1e-6 of a 4 m kind = 4 µm). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

type CatalogEntry = Record<string, unknown>;

interface ScanContext {
  kindId: string;
  entry: CatalogEntry;
  gltfPath: string;
}

async function loadGltf(gltfPath: string): Promise<Document> {
  const rel = gltfPath.startsWith('/') ? gltfPath.slice(1) : gltfPath;
  return io.read(path.resolve(STUDIO_PUBLIC, rel));
}

function logPrevious({ kindId, entry }: ScanContext): void {
  console.log(`[scan-colliders] ${kindId}`);
  console.log(`  previous:    ${JSON.stringify(entry.colliderShape ?? null)}`);
}

async function scanHeightfield(
  recipe: Extract<ColliderComplexity, { type: 'heightfield' }>,
  ctx: ScanContext,
): Promise<ColliderShapeSpec> {
  const { kindId, entry, gltfPath } = ctx;
  const result = scanColliderCuboids(await loadGltf(gltfPath), {
    cellSize: recipe.cellSize,
    heightEpsilon: recipe.heightEpsilon,
  });
  const spec = {
    kind: 'scanned-cuboids' as const,
    cuboids: result.cuboids.map((c) => ({
      min: c.min.map(round6) as [number, number, number],
      max: c.max.map(round6) as [number, number, number],
    })),
  };
  assertSurvivesNormalizer(entry, spec, kindId);

  const sizeY = result.aabb.max[1] - result.aabb.min[1];
  const sizeX = result.aabb.max[0] - result.aabb.min[0];
  const tops = [...new Set(spec.cuboids.map((c) => round6(c.max[1] * sizeY)))].sort(
    (a, b) => a - b,
  );
  console.log(`[scan-colliders] ${kindId}`);
  console.log(`  gltf:        ${gltfPath}`);
  console.log(`  triangles:   ${result.triangleCount}`);
  console.log(
    `  local AABB:  [${result.aabb.min.map(round6).join(', ')}] .. [${result.aabb.max.map(round6).join(', ')}]`,
  );
  console.log(`  previous:    ${JSON.stringify(entry.colliderShape ?? null)}`);
  console.log(
    `  cuboids:     ${spec.cuboids.length} (${round6(sizeX)} m span starting x=${round6(result.aabb.min[0])})`,
  );
  console.log(`  step tops:   ${tops.map((t) => t.toFixed(3)).join(', ')} m`);
  return spec;
}

async function scanTrimesh(ctx: ScanContext): Promise<ColliderShapeSpec> {
  const { kindId, entry, gltfPath } = ctx;
  const tm = scanColliderTrimesh(await loadGltf(gltfPath));
  const spec = {
    kind: 'trimesh' as const,
    positions: tm.positions.map(round6),
    indices: tm.indices,
  };
  assertSurvivesNormalizer(entry, spec, kindId);
  console.log(`[scan-colliders] ${kindId}`);
  console.log(`  gltf:        ${gltfPath}`);
  console.log(
    `  local AABB:  [${tm.aabb.min.map(round6).join(', ')}] .. [${tm.aabb.max.map(round6).join(', ')}]`,
  );
  console.log(`  previous:    ${JSON.stringify(entry.colliderShape ?? null)}`);
  console.log(
    `  trimesh:     ${tm.positions.length / 3} vertices, ${tm.triangleCount} triangles (welded)`,
  );
  return spec;
}

/** Scans one kind per its recipe; `undefined` means "no colliderShape". */
async function runRecipe(
  recipe: ColliderComplexity,
  ctx: ScanContext,
): Promise<ColliderShapeSpec | undefined> {
  switch (recipe.type) {
    case 'box':
      logPrevious(ctx);
      console.log('  box:         removing colliderShape (runtime uses the AABB)');
      return undefined;
    case 'heightfield':
      return scanHeightfield(recipe, ctx);
    case 'trimesh':
      return scanTrimesh(ctx);
    case 'profile':
      throw new Error(`kind "${ctx.kindId}": colliderComplexity "profile" is not implemented yet`);
    default: {
      const unhandled: never = recipe;
      throw new Error(`unhandled colliderComplexity ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The generated spec must survive the schema normalizer, or runtime
 * consumers would silently fall back to a single AABB. */
function assertSurvivesNormalizer(
  entry: CatalogEntry,
  spec: ColliderShapeSpec,
  kindId: string,
): void {
  if (normalizeKind({ ...entry, colliderShape: spec }, 0).colliderShape?.kind !== spec.kind) {
    throw new Error(`generated ${spec.kind} for "${kindId}" failed schema validation — not writing.`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const rawText = await fs.readFile(CATALOG_PATH, 'utf-8');
  const rawCatalog = JSON.parse(rawText) as {
    updatedAt: number;
    kinds: CatalogEntry[];
  };
  // Validate up front so we fail before touching anything.
  const validated = validateWorldObjectKindCatalog(rawCatalog);

  const recipes = new Map<string, ColliderComplexity>();
  for (const k of validated.kinds) {
    if (k.colliderComplexity) {
      recipes.set(k.id, k.colliderComplexity);
    }
  }
  const explicitRecipe: ColliderComplexity =
    args.mode === 'trimesh'
      ? { type: 'trimesh' }
      : { type: 'heightfield', cellSize: args.cellSize, heightEpsilon: args.heightEpsilon };
  const jobs: Array<[string, ColliderComplexity]> = args.all
    ? [...recipes]
    : args.kindIds.map((id) => [id, explicitRecipe]);
  if (jobs.length === 0) {
    throw new Error('no kinds carry a colliderComplexity recipe — nothing to scan');
  }

  for (const [kindId, recipe] of jobs) {
    const entry = rawCatalog.kinds.find((k) => k.id === kindId);
    if (!entry) {
      throw new Error(`kind "${kindId}" not found in ${CATALOG_PATH}`);
    }
    const spec = await runRecipe(recipe, { kindId, entry, gltfPath: entry.gltfPath as string });
    if (spec) {
      entry.colliderShape = spec;
    } else {
      delete entry.colliderShape;
    }
  }

  rawCatalog.updatedAt = Date.now();
  // Re-validate the whole mutated catalog before writing.
  validateWorldObjectKindCatalog(rawCatalog);
  await fs.writeFile(CATALOG_PATH, JSON.stringify(rawCatalog));
  console.log(
    `[scan-colliders] ✓ wrote ${jobs.length} colliderShape update(s) to ${CATALOG_PATH}`,
  );
}

main().catch((err) => {
  console.error('[scan-colliders] FAILED:', (err as Error).message);
  process.exit(1);
});
