/**
 * Curated cube-kind registry for the studio's Scenes mode. Each entry
 * declares a renderable, palette-listed kind: a stable id, a human
 * label for the palette, the GLB the renderer should instance, and
 * a swatch color for the palette thumbnail (until we render real
 * GLB-based thumbnails).
 *
 * Adding a new kind:
 *   1. Add an entry here.
 *   2. Copy the corresponding `<id>.gltf` + `<id>.bin` from
 *      `assets/KayKit_BlockBits_1.0_FREE/Assets/gltf/` into
 *      `packages/studio/public/models/blocks/`.
 *   3. Make sure `block_bits_texture.png` is present in the same
 *      public dir (all KayKit blocks share that atlas).
 *
 * Kept small for v1 — twelve variants is enough to exercise the
 * palette UX without copying all 40 GLBs.
 */

export interface CubeKindDef {
  id: string;
  label: string;
  /** Public URL the renderer loads via useGLTF. */
  gltfPath: string;
  /** CSS hex color used for the palette swatch. */
  swatch: string;
  /** Whether characters can stand on / pass through this cube. The
   * collision layer reads this when generating walls. */
  walkable: boolean;
}

export const CUBE_KINDS: readonly CubeKindDef[] = [
  {
    id: 'colored_block_blue',
    label: 'Blue block',
    gltfPath: '/models/blocks/colored_block_blue.gltf',
    swatch: '#3b82f6',
    walkable: false,
  },
  {
    id: 'colored_block_green',
    label: 'Green block',
    gltfPath: '/models/blocks/colored_block_green.gltf',
    swatch: '#22c55e',
    walkable: false,
  },
  {
    id: 'colored_block_red',
    label: 'Red block',
    gltfPath: '/models/blocks/colored_block_red.gltf',
    swatch: '#ef4444',
    walkable: false,
  },
  {
    id: 'colored_block_yellow',
    label: 'Yellow block',
    gltfPath: '/models/blocks/colored_block_yellow.gltf',
    swatch: '#facc15',
    walkable: false,
  },
  {
    id: 'stone',
    label: 'Stone',
    gltfPath: '/models/blocks/stone.gltf',
    swatch: '#9ca3af',
    walkable: false,
  },
  {
    id: 'stone_dark',
    label: 'Dark stone',
    gltfPath: '/models/blocks/stone_dark.gltf',
    swatch: '#4b5563',
    walkable: false,
  },
  {
    id: 'stone_with_gold',
    label: 'Gold ore',
    gltfPath: '/models/blocks/stone_with_gold.gltf',
    swatch: '#f59e0b',
    walkable: false,
  },
  {
    id: 'wood',
    label: 'Wood',
    gltfPath: '/models/blocks/wood.gltf',
    swatch: '#92400e',
    walkable: false,
  },
  {
    id: 'bricks_A',
    label: 'Bricks',
    gltfPath: '/models/blocks/bricks_A.gltf',
    swatch: '#b91c1c',
    walkable: false,
  },
  {
    id: 'dirt_with_grass',
    label: 'Grass',
    gltfPath: '/models/blocks/dirt_with_grass.gltf',
    swatch: '#65a30d',
    walkable: true,
  },
  {
    id: 'glass',
    label: 'Glass',
    gltfPath: '/models/blocks/glass.gltf',
    swatch: '#bfdbfe',
    walkable: false,
  },
  {
    id: 'lava',
    label: 'Lava',
    gltfPath: '/models/blocks/lava.gltf',
    swatch: '#ea580c',
    walkable: false,
  },
];

const BY_ID = new Map<string, CubeKindDef>(
  CUBE_KINDS.map((k) => [k.id, k]),
);

export function getCubeKind(id: string): CubeKindDef | undefined {
  return BY_ID.get(id);
}

/**
 * Convenience: a swatch color for an unknown kind id (so the
 * Inspector / palette can render *something* even when a scene
 * references a kind that's been renamed or removed).
 */
export const UNKNOWN_KIND_SWATCH = '#71717a';
