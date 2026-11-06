import type { DeskAreaState } from '@officexr/sdk';
import type { DeskArea, MapDocumentV2 } from '../scenes/index.ts';
import type { KindResolver } from './geometry-service.ts';
import type { Instances } from './room-bounds.ts';
import type { InstanceGeometryService } from './types.ts';

export type DeskViolation = 'multiple-seats' | 'multiple-desks';

export type ResolvedDeskArea = DeskAreaState & { violation: DeskViolation | null };

type Geometry = Pick<InstanceGeometryService, 'worldAABBOfInstance'>;
type Placed = { id: string; x: number; z: number; seat: boolean; desk: boolean };

export function deskAreaLabel(area: Pick<DeskArea, 'label'>): string {
  return area.label ?? 'Desk';
}

/** Chairs and desks among `instances`, with their world-AABB XZ centres. */
function placedFurniture(instances: Instances, catalog: KindResolver, geometry: Geometry): Placed[] {
  return instances.flatMap((inst) => {
    const kind = catalog.getKind(inst.kindId);
    const seat = kind?.seat !== undefined;
    const desk = kind?.isDesk === true;
    if (!seat && !desk) {
      return [];
    }
    const box = geometry.worldAABBOfInstance(inst);
    return { id: inst.id, x: (box.min[0] + box.max[0]) / 2, z: (box.min[2] + box.max[2]) / 2, seat, desk };
  });
}

function membersOf(area: Pick<DeskArea, 'min' | 'max'>, placed: readonly Placed[]) {
  const inside = placed.filter(
    (p) => p.x >= area.min.x && p.x <= area.max.x && p.z >= area.min.z && p.z <= area.max.z,
  );
  return { seats: inside.filter((p) => p.seat), desks: inside.filter((p) => p.desk) };
}

/** Chairs and desks whose world AABB centre lies inside the area (inclusive), by instance id. */
export function deskAreaMembers(
  area: Pick<DeskArea, 'min' | 'max'>,
  instances: Instances,
  catalog: KindResolver,
  geometry: Geometry,
): { seats: { id: string }[]; desks: { id: string }[] } {
  return membersOf(area, placedFurniture(instances, catalog, geometry));
}

/** A violated area has no seat: `seatInstanceId` is null whenever `violation` is set. Violation precedence: multiple seats, then multiple desks. */
export function resolveDeskAreas(
  map: Pick<MapDocumentV2, 'deskAreas'>,
  instances: Instances,
  catalog: KindResolver,
  geometry: Geometry,
): ResolvedDeskArea[] {
  const areas = map.deskAreas ?? [];
  if (areas.length === 0) {
    return [];
  }
  const placed = placedFurniture(instances, catalog, geometry);
  return areas.map((area) => {
    const { seats, desks } = membersOf(area, placed);
    const violation: DeskViolation | null =
      seats.length > 1 ? 'multiple-seats' : desks.length > 1 ? 'multiple-desks' : null;
    return {
      id: area.id,
      label: deskAreaLabel(area),
      min: area.min,
      max: area.max,
      seatInstanceId: violation === null ? (seats[0]?.id ?? null) : null,
      violation,
    };
  });
}
