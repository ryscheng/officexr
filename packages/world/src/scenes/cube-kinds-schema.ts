/**
 * Schema for the editable cube-kind catalog.
 *
 * v1 is the version landed in Task 3 of the studio restructure: it
 * extends the legacy `CubeKindDef` shape (id / label / gltfPath /
 * swatch / walkable) with per-kind material overrides that the Object
 * editor can tune (tint / opacity / roughness / metalness / emissive /
 * emissiveIntensity) plus a default scale multiplier and a category
 * for grouping in the Object editor's left-panel list.
 *
 * "No-change" defaults for the override fields are documented inline
 * so the renderer can short-circuit a clone when nothing has been
 * customized.
 */

/** Category groups the Object editor uses to sort kinds in its
 * left-panel list. `block` covers the original KayKit BlockBits set;
 * the others are seeded by Task 4 (KayKit Furniture / Prototype /
 * Restaurant packs). `character` is for avatar-related kinds (e.g.
 * character meshes from asset packs) — the room palette filters these
 * out so they don't appear as placeable objects. */
export type CubeKindCategory =
  | 'block'
  | 'furniture'
  | 'prototype'
  | 'restaurant'
  | 'character';

export const CUBE_KIND_CATEGORIES: readonly CubeKindCategory[] = [
  'block',
  'furniture',
  'prototype',
  'restaurant',
  'character',
];

export interface CubeKindEntry {
  /** Stable id; do NOT rename — every room doc references kinds by id. */
  id: string;
  label: string;
  /** Public URL the renderer loads via `useGLTF`. */
  gltfPath: string;
  /** CSS hex used for the palette swatch + spawn-marker fallback. */
  swatch: string;
  /** Whether characters can stand on / pass through this cube. */
  walkable: boolean;
  /** Uniform instance-matrix scale multiplier. Default 1 = no change. */
  scale: number;
  /** Color tint applied on top of the GLTF material's `color`. Null =
   * use the GLTF material's color as-is. */
  tint: string | null;
  /** Per-instance opacity 0..1. 1 = fully opaque. < 1 enables
   * `transparent: true` on the cloned material. */
  opacity: number;
  /** PBR roughness override. Null = inherit from GLTF material. */
  roughness: number | null;
  /** PBR metalness override. Null = inherit from GLTF material. */
  metalness: number | null;
  /** Emissive color. Null = no emission. */
  emissive: string | null;
  /** Emissive intensity scalar. Ignored when `emissive` is null. */
  emissiveIntensity: number;
  /** Object-editor grouping label. Does not affect the renderer. */
  category: CubeKindCategory;
}

export interface CubeKindCatalogV1 {
  schemaVersion: 1;
  updatedAt: number;
  kinds: CubeKindEntry[];
}

/** Defaults applied to entries whose override fields are missing
 * (e.g. a legacy `CubeKindDef` widened into the new shape). Mirrors
 * the "no behavior change" baseline. */
export const CUBE_KIND_DEFAULTS = {
  scale: 1,
  tint: null as string | null,
  opacity: 1,
  roughness: null as number | null,
  metalness: null as number | null,
  emissive: null as string | null,
  emissiveIntensity: 0,
  category: 'block' as CubeKindCategory,
} as const;

/** Validate + normalize a parsed JSON object into a CubeKindCatalogV1.
 * Throws on invalid input so the loader can surface the failure to
 * the user instead of silently substituting a stale value. */
export function validateCubeKindCatalog(raw: unknown): CubeKindCatalogV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('cube-catalog: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `cube-catalog: unsupported schemaVersion ${String(obj.schemaVersion)}`,
    );
  }
  if (!Array.isArray(obj.kinds)) {
    throw new Error('cube-catalog: missing `kinds` array');
  }
  const updatedAt =
    typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now();
  const kinds: CubeKindEntry[] = obj.kinds.map((k, i) => normalizeKind(k, i));
  return { schemaVersion: 1, updatedAt, kinds };
}

function normalizeKind(raw: unknown, idx: number): CubeKindEntry {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`cube-catalog: kinds[${idx}] is not an object`);
  }
  const k = raw as Record<string, unknown>;
  const requireString = (field: string): string => {
    const v = k[field];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`cube-catalog: kinds[${idx}].${field} must be a non-empty string`);
    }
    return v;
  };
  return {
    id: requireString('id'),
    label: requireString('label'),
    gltfPath: requireString('gltfPath'),
    swatch: requireString('swatch'),
    walkable: Boolean(k.walkable ?? false),
    scale: typeof k.scale === 'number' ? k.scale : CUBE_KIND_DEFAULTS.scale,
    tint: typeof k.tint === 'string' ? k.tint : CUBE_KIND_DEFAULTS.tint,
    opacity: typeof k.opacity === 'number' ? k.opacity : CUBE_KIND_DEFAULTS.opacity,
    roughness:
      typeof k.roughness === 'number' ? k.roughness : CUBE_KIND_DEFAULTS.roughness,
    metalness:
      typeof k.metalness === 'number' ? k.metalness : CUBE_KIND_DEFAULTS.metalness,
    emissive:
      typeof k.emissive === 'string' ? k.emissive : CUBE_KIND_DEFAULTS.emissive,
    emissiveIntensity:
      typeof k.emissiveIntensity === 'number'
        ? k.emissiveIntensity
        : CUBE_KIND_DEFAULTS.emissiveIntensity,
    category: isCategory(k.category)
      ? (k.category as CubeKindCategory)
      : CUBE_KIND_DEFAULTS.category,
  };
}

function isCategory(v: unknown): v is CubeKindCategory {
  return typeof v === 'string' && (CUBE_KIND_CATEGORIES as readonly string[]).includes(v);
}
