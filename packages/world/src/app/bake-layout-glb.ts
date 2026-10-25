import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import type { LayoutDocument } from '../scenes/layout-document.ts';
import {
  normalizeKind,
  validateWorldObjectKindCatalog,
  type WorldObjectKind,
  type WorldObjectKindCatalogV1,
} from '../scenes/world-object-kinds-schema.ts';
import { createInstanceGeometry } from './geometry-service.ts';
import { bakeLayout, type BakeResultBytes } from './layout-bake-service.ts';

// Matches the runtime convention `createDefaultApi` passes to the geometry service.
const VOXEL_SIZE = 0.5;

const WORLD_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function readCatalogFile(): Promise<WorldObjectKindCatalogV1> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(WORLD_ROOT, 'world-object-kinds.json'), 'utf-8');
  } catch {
    raw = await fs.readFile(path.join(WORLD_ROOT, 'world-object-kinds.default.json'), 'utf-8');
  }
  return validateWorldObjectKindCatalog(JSON.parse(raw) as unknown);
}

export interface BakeLayoutGlbOptions {
  layout: LayoutDocument;
  /** Directory that a kind's `/models/...` gltfPath resolves against (the studio's `public/`). */
  modelRoot: string;
  /** The catalog to resolve kinds from; the catalog file, or its default, when omitted or null. */
  catalog?: WorldObjectKindCatalogV1 | null;
  /** Overrides the layout's own `optimizer`. */
  optimizer?: string;
}

/** Bakes a layout into one GLB under Node, reading kind models from `modelRoot`. */
export async function bakeLayoutGlb({
  layout,
  modelRoot,
  catalog,
  optimizer,
}: BakeLayoutGlbOptions): Promise<BakeResultBytes> {
  const kinds = new Map<string, WorldObjectKind>();
  for (const [idx, kind] of (catalog ?? (await readCatalogFile())).kinds.entries()) {
    kinds.set(kind.id, normalizeKind(kind, idx));
  }
  const geometry = createInstanceGeometry({ catalog: { getKind: (id) => kinds.get(id) }, voxelSize: VOXEL_SIZE });

  // Re-emitting as a GLB lets catalog entries stay multi-file .gltf bundles.
  const io = new NodeIO();
  const loadGltf = async (url: string) =>
    io.writeBinary(await io.read(path.resolve(modelRoot, url.replace(/^\//, ''))));

  return bakeLayout(layout, (id) => kinds.get(id), loadGltf, geometry, { optimizer: optimizer ?? layout.optimizer });
}
