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
  normalizeColliderComplexity,
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
  mode: 'cuboids' | 'trimesh';
  all: boolean;
  cellSize: number;
  heightEpsilon: number;
  kindIds: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'cuboids',
    all: false,
    cellSize: 0.125,
    heightEpsilon: 0.01,
    kindIds: [],
  };
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
  if (!Number.isFinite(args.cellSize) || args.cellSize <= 0) {
    throw new Error('--cell must be a positive number (metres)');
  }
  if (!Number.isFinite(args.heightEpsilon) || args.heightEpsilon <= 0) {
    throw new Error('--eps must be a positive number (metres)');
  }
  if (args.all && args.kindIds.length > 0) {
    throw new Error('--all cannot be combined with explicit kind ids');
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
  doc: Document;
  defaults: { cellSize: number; heightEpsilon: number };
}

/** Scans one kind per recipe type; `undefined` means "no colliderShape". */
type ScanStrategy<T extends ColliderComplexity['type']> = (
  recipe: Extract<ColliderComplexity, { type: T }>,
  ctx: ScanContext,
) => ColliderShapeSpec | undefined;

const SCAN_STRATEGIES: { [T in ColliderComplexity['type']]: ScanStrategy<T> } = {
  box: (_recipe, { kindId, entry }) => {
    console.log(`[scan-colliders] ${kindId}`);
    console.log(`  previous:    ${JSON.stringify(entry.colliderShape ?? null)}`);
    console.log('  box:         removing colliderShape (runtime uses the AABB)');
    return undefined;
  },
  heightfield: (recipe, { kindId, entry, gltfPath, doc, defaults }) => {
    const cellSize = recipe.cellSize ?? defaults.cellSize;
    const result = scanColliderCuboids(doc, {
      cellSize,
      heightEpsilon: recipe.heightEpsilon ?? defaults.heightEpsilon,
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
      `  cuboids:     ${spec.cuboids.length} (cell=${cellSize} m over ${round6(sizeX)} m span starting x=${round6(result.aabb.min[0])})`,
    );
    console.log(`  step tops:   ${tops.map((t) => t.toFixed(3)).join(', ')} m`);
    return spec;
  },
  trimesh: (_recipe, { kindId, entry, gltfPath, doc }) => {
    const tm = scanColliderTrimesh(doc);
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
  },
  profile: (_recipe, { kindId }) => {
    throw new Error(`kind "${kindId}": colliderComplexity "profile" is not implemented yet`);
  },
};

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

function runStrategy(recipe: ColliderComplexity, ctx: ScanContext): ColliderShapeSpec | undefined {
  const strategy = SCAN_STRATEGIES[recipe.type] as ScanStrategy<typeof recipe.type>;
  return strategy(recipe, ctx);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const rawText = await fs.readFile(CATALOG_PATH, 'utf-8');
  const rawCatalog = JSON.parse(rawText) as {
    updatedAt: number;
    kinds: CatalogEntry[];
  };
  // Validate up front so we fail before touching anything.
  validateWorldObjectKindCatalog(rawCatalog);

  const kindIds = args.all
    ? rawCatalog.kinds.filter((k) => k.colliderComplexity !== undefined).map((k) => k.id as string)
    : args.kindIds;
  if (kindIds.length === 0) {
    throw new Error('no kinds carry a colliderComplexity recipe — nothing to scan');
  }

  for (const kindId of kindIds) {
    const entry = rawCatalog.kinds.find((k) => k.id === kindId);
    if (!entry) {
      throw new Error(`kind "${kindId}" not found in ${CATALOG_PATH}`);
    }
    const recipe: ColliderComplexity = args.all
      ? (normalizeColliderComplexity(entry.colliderComplexity, 0) as ColliderComplexity)
      : args.mode === 'trimesh'
        ? { type: 'trimesh' }
        : { type: 'heightfield' };
    const gltfPath = entry.gltfPath as string;
    const rel = gltfPath.startsWith('/') ? gltfPath.slice(1) : gltfPath;
    const doc = await io.read(path.resolve(STUDIO_PUBLIC, rel));
    const spec = runStrategy(recipe, {
      kindId,
      entry,
      gltfPath,
      doc,
      defaults: { cellSize: args.cellSize, heightEpsilon: args.heightEpsilon },
    });
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
    `[scan-colliders] ✓ wrote ${kindIds.length} colliderShape update(s) to ${CATALOG_PATH}`,
  );
}

main().catch((err) => {
  console.error('[scan-colliders] FAILED:', (err as Error).message);
  process.exit(1);
});
