/**
 * Collider scanner CLI — derives collider geometry for catalog kinds by
 * scanning their actual GLB meshes, and writes the result into
 * `world-object-kinds.json` as a `colliderShape` override.
 *
 *   pnpm --filter @officexr/world scan:colliders -- \
 *     [--mode=cuboids] [--cell=0.125] [--eps=0.01] <kindId> [<kindId> ...]
 *
 * Modes:
 *   cuboids (default) — voxel-stepped solid columns from an XZ
 *     heightfield (stairs and stair-like solids). See
 *     `src/app/collider-scan.ts` for the algorithm + limitations.
 *   trimesh — reserved for slope kinds (lands with trimesh collider
 *     support; the flag errors until then so nobody half-ships it).
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
import { NodeIO } from '@gltf-transform/core';
import {
  scanColliderCuboids,
  scanColliderTrimesh,
} from '../src/app/collider-scan.ts';
import {
  normalizeKind,
  validateWorldObjectKindCatalog,
} from '../src/scenes/world-object-kinds-schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(HERE, '..');
const STUDIO_PUBLIC = path.resolve(WORLD_ROOT, '../../packages/studio/public');
const CATALOG_PATH = path.resolve(WORLD_ROOT, 'world-object-kinds.json');

const io = new NodeIO();

interface CliArgs {
  mode: 'cuboids' | 'trimesh';
  cellSize: number;
  heightEpsilon: number;
  kindIds: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'cuboids',
    cellSize: 0.125,
    heightEpsilon: 0.01,
    kindIds: [],
  };
  for (const a of argv) {
    if (a === '--') continue; // pnpm passes the arg separator through
    if (a.startsWith('--mode=')) {
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
  if (args.kindIds.length === 0) {
    throw new Error(
      'usage: scan-kind-colliders [--mode=cuboids] [--cell=0.125] [--eps=0.01] <kindId> ...',
    );
  }
  return args;
}

/** Round to 6 decimals — keeps the catalog diff stable and readable
 * without losing meaningful precision (1e-6 of a 4 m kind = 4 µm). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const rawText = await fs.readFile(CATALOG_PATH, 'utf-8');
  const rawCatalog = JSON.parse(rawText) as {
    updatedAt: number;
    kinds: Array<Record<string, unknown>>;
  };
  // Validate up front so we fail before touching anything.
  validateWorldObjectKindCatalog(rawCatalog);

  for (const kindId of args.kindIds) {
    const entry = rawCatalog.kinds.find((k) => k.id === kindId);
    if (!entry) {
      throw new Error(`kind "${kindId}" not found in ${CATALOG_PATH}`);
    }
    const gltfPath = entry.gltfPath as string;
    const rel = gltfPath.startsWith('/') ? gltfPath.slice(1) : gltfPath;
    const absPath = path.resolve(STUDIO_PUBLIC, rel);
    const doc = await io.read(absPath);

    if (args.mode === 'trimesh') {
      const tm = scanColliderTrimesh(doc);
      const spec = {
        kind: 'trimesh' as const,
        positions: tm.positions.map(round6),
        indices: tm.indices,
      };
      const normalized = normalizeKind({ ...entry, colliderShape: spec }, 0);
      if (normalized.colliderShape?.kind !== 'trimesh') {
        throw new Error(
          `generated trimesh for "${kindId}" failed schema validation — not writing.`,
        );
      }
      console.log(`[scan-colliders] ${kindId}`);
      console.log(`  gltf:        ${gltfPath}`);
      console.log(
        `  local AABB:  [${tm.aabb.min.map(round6).join(', ')}] .. [${tm.aabb.max.map(round6).join(', ')}]`,
      );
      console.log(`  previous:    ${JSON.stringify(entry.colliderShape ?? null)}`);
      console.log(
        `  trimesh:     ${tm.positions.length / 3} vertices, ${tm.triangleCount} triangles (welded)`,
      );
      entry.colliderShape = spec;
      continue;
    }

    const result = scanColliderCuboids(doc, {
      cellSize: args.cellSize,
      heightEpsilon: args.heightEpsilon,
    });

    const spec = {
      kind: 'scanned-cuboids' as const,
      cuboids: result.cuboids.map((c) => ({
        min: c.min.map(round6) as [number, number, number],
        max: c.max.map(round6) as [number, number, number],
      })),
    };

    // Self-check: the generated spec must survive the schema
    // normalizer, or runtime consumers would silently fall back to a
    // single AABB.
    const normalized = normalizeKind({ ...entry, colliderShape: spec }, 0);
    if (normalized.colliderShape?.kind !== 'scanned-cuboids') {
      throw new Error(
        `generated spec for "${kindId}" failed schema validation — not writing.`,
      );
    }

    // Review table.
    const [minL, , ] = result.aabb.min;
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
      `  cuboids:     ${spec.cuboids.length} (cell=${args.cellSize} m over ${round6(sizeX)} m span starting x=${round6(minL)})`,
    );
    console.log(`  step tops:   ${tops.map((t) => t.toFixed(3)).join(', ')} m`);

    entry.colliderShape = spec;
  }

  rawCatalog.updatedAt = Date.now();
  // Re-validate the whole mutated catalog before writing.
  validateWorldObjectKindCatalog(rawCatalog);
  await fs.writeFile(CATALOG_PATH, JSON.stringify(rawCatalog));
  console.log(
    `[scan-colliders] ✓ wrote ${args.kindIds.length} colliderShape override(s) to ${CATALOG_PATH}`,
  );
}

main().catch((err) => {
  console.error('[scan-colliders] FAILED:', (err as Error).message);
  process.exit(1);
});
