import { z } from 'zod';

export const PLACEABLE_KINDS = [
  { kindId: 'prop_pool', label: 'Pool' },
  { kindId: 'prop_scooter_rack', label: 'Scooter rack' },
  { kindId: 'prop_tricycle_rack', label: 'Tricycle rack' },
  { kindId: 'prop_wand_stand', label: 'Wand stand' },
] as const;

export type PlaceableKindId = (typeof PLACEABLE_KINDS)[number]['kindId'];

export const WAND_STAND_KIND: PlaceableKindId = 'prop_wand_stand';
export const MAX_PLACED_PROPS = 50;
export const PLACED_ID_PREFIX = 'placed:';
/** Grid step for x, y and z, in voxels. */
export const PLACE_STEP_VOXELS = 0.5;
const COORD_LIMIT = 500;

export const isPlaceableKind = (kindId: unknown): kindId is PlaceableKindId =>
  PLACEABLE_KINDS.some((k) => k.kindId === kindId);

export interface PlacedProp {
  id: string;
  kindId: PlaceableKindId;
  position: [number, number, number];
  yawDeg: number;
}

const onGrid = (v: number) => Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT && Number.isInteger(v / PLACE_STEP_VOXELS);

export const ZPropPlacement = z.object({
  kindId: z.string().refine(isPlaceableKind, 'Unknown prop'),
  position: z.tuple([z.number(), z.number(), z.number()]).refine(
    ([x, y, z]) => onGrid(x) && onGrid(y) && onGrid(z),
    'Position is off the grid',
  ),
  yawDeg: z.number().refine((v) => [0, 90, 180, 270].includes(v), 'yawDeg must be 0, 90, 180 or 270'),
});

export type PropPlacement = { kindId: PlaceableKindId; position: [number, number, number]; yawDeg: number };

export const ZPlacedProp = ZPropPlacement.extend({ id: z.string().min(1).max(64) });

export const snapToGrid = (v: number) => Math.round(v / PLACE_STEP_VOXELS) * PLACE_STEP_VOXELS;
export const rotateYaw = (yawDeg: number) => (yawDeg + 90) % 360;
export const isPlacedId = (id: string) => id.startsWith(PLACED_ID_PREFIX);

export function propToInstance(p: PlacedProp): {
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
  yawDeg: number;
} {
  return { id: p.id, sourceCommandId: p.id, kindId: p.kindId, position: p.position, yawDeg: p.yawDeg };
}
