import type { DeskArea, SerializedMap } from '@officexr/world/scenes';
import { VOXEL_SIZE } from '@officexr/world/renderer';

type Bounds = Pick<DeskArea, 'min' | 'max'>;

const snap = (v: number) => Math.round(v / VOXEL_SIZE) * VOXEL_SIZE;

/** Voxel-grid-snapped rectangle spanned by two floor points, or null when it has no area. */
export function snapDeskAreaBounds(
  a: { x: number; z: number },
  b: { x: number; z: number },
): Bounds | null {
  const min = { x: snap(Math.min(a.x, b.x)), z: snap(Math.min(a.z, b.z)) };
  const max = { x: snap(Math.max(a.x, b.x)), z: snap(Math.max(a.z, b.z)) };
  return min.x === max.x || min.z === max.z ? null : { min, max };
}

/** Desk areas of any map version (v1 documents have none). */
export function deskAreasOf(doc: SerializedMap): readonly DeskArea[] {
  return 'deskAreas' in doc ? (doc.deskAreas ?? []) : [];
}
