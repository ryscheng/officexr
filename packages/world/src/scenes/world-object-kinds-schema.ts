/**
 * Schema for the editable world-object-kind catalog.
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

// OCP: optimization enum — any new variant added here will produce a compile
// error in the renderer switch (if one is added) because the exhaustive type
// check will fail at compile time. New variants must be handled before they
// can be merged.
export type OptimizationMode = 'none' | 'static-batch' | 'frustum-cull';

export interface WorldObjectKind {
  /** Stable id; do NOT rename — every room doc references kinds by id. */
  id: string;
  label: string;
  /** Public URL the renderer loads via `useGLTF`. */
  gltfPath: string;
  /** CSS hex used for the palette swatch + spawn-marker fallback. */
  swatch: string;
  /** Whether characters can stand on / pass through this object. */
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
  /** Whether this kind tiles along each axis. Block-category kinds
   * default to all-axes tileable; all other categories default to
   * non-tileable. Can be overridden per-kind in the catalog JSON. */
  tilingAxes: { x: boolean; y: boolean; z: boolean };
  /** Whether this kind is affected by gravity placement (drop-to-surface).
   * Default false for all categories. */
  gravity: boolean;
  /** Whether this kind is structural geometry (walls, floors, structural
   * pieces) that belongs in Layout view. Default false = furnishing.
   * Layout view filters to require this; Room view hides it by default
   * (session toggle to show all). */
  isLayoutObject: boolean;
  /** Renderer optimization hint. 'none' = no special handling.
   * 'static-batch' and 'frustum-cull' are scaffolded for future use. */
  optimization: OptimizationMode;
  /** Axis-aligned bounding-box extents in metres (post-`scale`). */
  dimensions?: { width: number; height: number; depth: number };
  /** Local-coordinate AABB of the GLTF geometry (post-`scale`), in
   * metres. Different kinds have different origin conventions:
   *   - KayKit BlockBits (`colored_block_*`, `stone*`, …) are FULLY
   *     centered on origin, AABB e.g. (-1, -1, -1) → (1, 1, 1).
   *   - KayKit Prototype cubes are X/Z-centered, Y-bottom, AABB e.g.
   *     (-2, 0, -2) → (2, 4, 2).
   *   - Furniture / Restaurant kinds vary further.
   *
   * The InstanceGeometryService uses this to translate the mesh at
   * render time so the AABB's lower-left-bottom lands at the voxel
   * position — i.e. a cube at voxel (0,0,0) on a 0.5 m grid lives in
   * the world cell (0,0,0)→(w,h,d) regardless of GLTF origin.
   *
   * Populated by the bake script. When undefined the geometry service
   * falls back to assuming X/Z-centered, Y-bottom (the prototype-cube
   * pattern, most common after the asset-pack install). */
  localAABB?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /**
   * Optional override for the Rapier collider shape emitted by
   * `MapColliders` and `worldObjectsToCuboids`. When absent the default
   * is a single AABB cuboid (one-box-per-placed-object).
   *
   * 'compound-steps': emit one solid column per step instead of a single
   * bounding-box cuboid. Intended for staircase kinds whose single-AABB
   * collider would block the character at the front face rather than
   * letting it climb the steps. Step parameters (`stepCount`, `stepRise`,
   * `stepRun`, `stepDepth`) describe the staircase geometry in the kind's
   * own local space; `worldObjectsToCuboids` / `MapColliders` translate
   * them to world space at placement time.
   *
   * OCP note: new collider shapes (e.g. 'slope', 'hollow') would each
   * add an entry to this discriminated union rather than modifying the
   * default AABB path — the default path stays unchanged.
   */
  colliderShape?: ColliderShapeSpec;
}

/**
 * Discriminated union of optional collider-shape overrides for kinds
 * that cannot be accurately represented by a single AABB cuboid.
 *
 * ISP note: callers that only emit the default AABB collider never need
 * to read this field — it is consumed exclusively by MapColliders and
 * worldObjectsToCuboids, both of which are the correct level of
 * abstraction for this decision.
 */
export type ColliderShapeSpec =
  | CompoundStepsSpec
  | ScannedCuboidsSpec;

/**
 * Compound staircase collider: one solid column per step, ascending in
 * the +X direction (the first step's near face is at localAABB.max.x,
 * and each step adds `stepRun` in the −X direction while adding `stepRise`
 * in the +Y direction). All columns span the full Z depth of the kind.
 *
 * The staircase described by `prototype_primitive_stairs` has:
 *   stepCount=8, stepRise=0.5, stepRun=0.5, stepDepth=4
 * (derived from the binary audit of Primitive_Stairs.bin in task-05).
 */
export interface CompoundStepsSpec {
  kind: 'compound-steps';
  /** Number of steps. */
  stepCount: number;
  /** Height gain per step (metres, positive). */
  stepRise: number;
  /** Horizontal run per step (metres, positive), along the local X axis. */
  stepRun: number;
  /** Depth of each step column (metres), along the local Z axis. Typically
   * equals the kind's localAABB Z span. */
  stepDepth: number;
}

/** Hard cap on scanned cuboids per kind — a collider denser than this
 * is unreviewable and should be re-scanned at a coarser cell size. */
export const SCANNED_CUBOIDS_MAX = 256;

/**
 * Geometry-scanned collider: axis-aligned boxes generated from the
 * kind's actual GLB mesh by the collider scanner
 * (`app/collider-scan.ts`, written via `pnpm scan:colliders`).
 *
 * Coordinates are NORMALIZED 0..1 against the kind's local mesh AABB.
 * Consumers map them through the per-instance `worldAABB(position,
 * kindId)` they already have (`world = aabb.min + n·aabbSize` per
 * axis), which keeps the data independent of voxel-size / mesh-origin
 * / uniform-scale conventions — and survives those conventions
 * changing.
 */
export interface ScannedCuboidsSpec {
  kind: 'scanned-cuboids';
  cuboids: Array<{
    min: [number, number, number];
    max: [number, number, number];
  }>;
}

export interface WorldObjectKindCatalogV1 {
  schemaVersion: 1;
  updatedAt: number;
  kinds: WorldObjectKind[];
}

/** Defaults applied to entries whose override fields are missing
 * (e.g. a legacy `CubeKindDef` widened into the new shape). Mirrors
 * the "no behavior change" baseline.
 *
 * Note: `tilingAxes` is NOT in this constant because the default depends on
 * the entry's `category` field (blocks = all-axes tileable, others = non-tileable).
 * The category-conditional default is applied in `normalizeKind`. */
export const WORLD_OBJECT_KIND_DEFAULTS = {
  scale: 1,
  tint: null as string | null,
  opacity: 1,
  roughness: null as number | null,
  metalness: null as number | null,
  emissive: null as string | null,
  emissiveIntensity: 0,
  category: 'block' as CubeKindCategory,
  tilingAxes: { x: false, y: false, z: false },
  gravity: false,
  isLayoutObject: false,
  optimization: 'none' as OptimizationMode,
} as const;

/** Validate + normalize a parsed JSON object into a WorldObjectKindCatalogV1.
 * Throws on invalid input so the loader can surface the failure to
 * the user instead of silently substituting a stale value. */
export function validateWorldObjectKindCatalog(raw: unknown): WorldObjectKindCatalogV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('world-object-kind-catalog: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(
      `world-object-kind-catalog: unsupported schemaVersion ${String(obj.schemaVersion)}`,
    );
  }
  if (!Array.isArray(obj.kinds)) {
    throw new Error('world-object-kind-catalog: missing `kinds` array');
  }
  const updatedAt =
    typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now();
  const kinds: WorldObjectKind[] = obj.kinds.map((k, i) => normalizeKind(k, i));
  return { schemaVersion: 1, updatedAt, kinds };
}

const OPTIMIZATION_VALUES: readonly OptimizationMode[] = ['none', 'static-batch', 'frustum-cull'];

function isOptimizationMode(v: unknown): v is OptimizationMode {
  return typeof v === 'string' && (OPTIMIZATION_VALUES as readonly string[]).includes(v);
}

function normalizeTilingAxes(
  raw: unknown,
  category: CubeKindCategory,
): { x: boolean; y: boolean; z: boolean } {
  const blockDefault = category === 'block';
  if (raw && typeof raw === 'object') {
    const t = raw as Record<string, unknown>;
    if (
      typeof t.x === 'boolean' &&
      typeof t.y === 'boolean' &&
      typeof t.z === 'boolean'
    ) {
      return { x: t.x, y: t.y, z: t.z };
    }
  }
  return { x: blockDefault, y: blockDefault, z: blockDefault };
}

export function normalizeKind(raw: unknown, idx: number): WorldObjectKind {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`world-object-kind-catalog: kinds[${idx}] is not an object`);
  }
  const k = raw as Record<string, unknown>;
  const requireString = (field: string): string => {
    const v = k[field];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`world-object-kind-catalog: kinds[${idx}].${field} must be a non-empty string`);
    }
    return v;
  };
  const category: CubeKindCategory = isCategory(k.category)
    ? (k.category as CubeKindCategory)
    : WORLD_OBJECT_KIND_DEFAULTS.category;
  return {
    id: requireString('id'),
    label: requireString('label'),
    gltfPath: requireString('gltfPath'),
    swatch: requireString('swatch'),
    walkable: Boolean(k.walkable ?? false),
    scale: typeof k.scale === 'number' ? k.scale : WORLD_OBJECT_KIND_DEFAULTS.scale,
    tint: typeof k.tint === 'string' ? k.tint : WORLD_OBJECT_KIND_DEFAULTS.tint,
    opacity: typeof k.opacity === 'number' ? k.opacity : WORLD_OBJECT_KIND_DEFAULTS.opacity,
    roughness:
      typeof k.roughness === 'number' ? k.roughness : WORLD_OBJECT_KIND_DEFAULTS.roughness,
    metalness:
      typeof k.metalness === 'number' ? k.metalness : WORLD_OBJECT_KIND_DEFAULTS.metalness,
    emissive:
      typeof k.emissive === 'string' ? k.emissive : WORLD_OBJECT_KIND_DEFAULTS.emissive,
    emissiveIntensity:
      typeof k.emissiveIntensity === 'number'
        ? k.emissiveIntensity
        : WORLD_OBJECT_KIND_DEFAULTS.emissiveIntensity,
    category,
    tilingAxes: normalizeTilingAxes(k.tilingAxes, category),
    gravity: typeof k.gravity === 'boolean' ? k.gravity : WORLD_OBJECT_KIND_DEFAULTS.gravity,
    isLayoutObject:
      typeof k.isLayoutObject === 'boolean'
        ? k.isLayoutObject
        : WORLD_OBJECT_KIND_DEFAULTS.isLayoutObject,
    optimization: isOptimizationMode(k.optimization)
      ? k.optimization
      : WORLD_OBJECT_KIND_DEFAULTS.optimization,
    dimensions: normalizeDimensions(k.dimensions),
    localAABB: normalizeLocalAABB(k.localAABB),
    colliderShape: normalizeColliderShape(k.colliderShape),
  };
}

function normalizeDimensions(
  raw: unknown,
): { width: number; height: number; depth: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  if (
    typeof d.width === 'number' &&
    typeof d.height === 'number' &&
    typeof d.depth === 'number' &&
    d.width > 0 &&
    d.height > 0 &&
    d.depth > 0
  ) {
    return { width: d.width, height: d.height, depth: d.depth };
  }
  return undefined;
}

function normalizeXYZ(raw: unknown): { x: number; y: number; z: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') {
    return null;
  }
  return { x: v.x, y: v.y, z: v.z };
}

function normalizeLocalAABB(raw: unknown):
  | { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const min = normalizeXYZ(a.min);
  const max = normalizeXYZ(a.max);
  if (!min || !max) return undefined;
  if (max.x <= min.x || max.y <= min.y || max.z <= min.z) return undefined;
  return { min, max };
}

function isCategory(v: unknown): v is CubeKindCategory {
  return typeof v === 'string' && (CUBE_KIND_CATEGORIES as readonly string[]).includes(v);
}

function normalizeColliderShape(raw: unknown): ColliderShapeSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'compound-steps') {
    if (
      typeof s.stepCount === 'number' && s.stepCount > 0 &&
      typeof s.stepRise === 'number' && s.stepRise > 0 &&
      typeof s.stepRun === 'number' && s.stepRun > 0 &&
      typeof s.stepDepth === 'number' && s.stepDepth > 0
    ) {
      return {
        kind: 'compound-steps',
        stepCount: s.stepCount,
        stepRise: s.stepRise,
        stepRun: s.stepRun,
        stepDepth: s.stepDepth,
      };
    }
  }
  if (s.kind === 'scanned-cuboids') {
    const cuboids = normalizeScannedCuboids(s.cuboids);
    if (cuboids) return { kind: 'scanned-cuboids', cuboids };
  }
  return undefined;
}

/** Validate the scanner's normalized-cuboid list. Rejecting the whole
 * shape (→ undefined → plain AABB collider) on ANY malformed entry is
 * deliberate: a partially-valid scan is a silently-wrong collider. */
function normalizeScannedCuboids(
  raw: unknown,
): ScannedCuboidsSpec['cuboids'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > SCANNED_CUBOIDS_MAX) {
    return undefined;
  }
  const out: ScannedCuboidsSpec['cuboids'] = [];
  for (const c of raw) {
    const min = (c as { min?: unknown })?.min;
    const max = (c as { max?: unknown })?.max;
    if (!isNormalizedVec3(min) || !isNormalizedVec3(max)) return undefined;
    for (let axis = 0; axis < 3; axis++) {
      if (!(min[axis] < max[axis])) return undefined;
    }
    out.push({ min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] });
  }
  return out;
}

function isNormalizedVec3(v: unknown): v is [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) return false;
  // Small tolerance outside [0,1] absorbs float noise from the
  // scanner's AABB division without admitting wild values.
  return v.every(
    (n) => typeof n === 'number' && Number.isFinite(n) && n >= -0.01 && n <= 1.01,
  );
}

// ---------------------------------------------------------------------------
// Back-compat type aliases so files that imported the old names keep compiling
// during the rename transition. These aliases are intentionally re-exported
// from the scenes index.ts alongside the canonical names.
// ---------------------------------------------------------------------------

/** @deprecated Use WorldObjectKind */
export type CubeKindEntry = WorldObjectKind;

/** @deprecated Use WorldObjectKindCatalogV1 */
export type CubeKindCatalogV1 = WorldObjectKindCatalogV1;

/** @deprecated Use WORLD_OBJECT_KIND_DEFAULTS */
export const CUBE_KIND_DEFAULTS = WORLD_OBJECT_KIND_DEFAULTS;

/** @deprecated Use validateWorldObjectKindCatalog */
export const validateCubeKindCatalog = validateWorldObjectKindCatalog;
