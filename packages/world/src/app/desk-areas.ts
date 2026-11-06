import type { DeskAreaState } from '@officexr/sdk';
import type { DeskArea, MapDocumentV2 } from '../scenes/index.ts';
import type { KindResolver } from './geometry-service.ts';
import type { Instances } from './room-bounds.ts';
import type { InstanceGeometryService } from './types.ts';

export type DeskViolation = 'multiple-seats' | 'multiple-desks';

export type ResolvedDeskArea = DeskAreaState & { violation: DeskViolation | null };

/** Instances whose world AABB centre lies inside the area (inclusive), split into chairs and desks. */
export function deskAreaMembers(
  area: Pick<DeskArea, 'min' | 'max'>,
  instances: Instances,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): { seats: Instances; desks: Instances } {
  const seats: Instances = [];
  const desks: Instances = [];
  for (const inst of instances) {
    const kind = catalog.getKind(inst.kindId);
    if (kind?.seat === undefined && kind?.isDesk !== true) {
      continue;
    }
    const box = geometry.worldAABBOfInstance(inst);
    const x = (box.min[0] + box.max[0]) / 2;
    const z = (box.min[2] + box.max[2]) / 2;
    if (x < area.min.x || x > area.max.x || z < area.min.z || z > area.max.z) {
      continue;
    }
    if (kind.seat !== undefined) {
      seats.push(inst);
    }
    if (kind.isDesk === true) {
      desks.push(inst);
    }
  }
  return { seats, desks };
}

/** A violated area has no seat: `seatInstanceId` is null whenever `violation` is set. */
export function resolveDeskAreas(
  map: Pick<MapDocumentV2, 'deskAreas'>,
  instances: Instances,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): ResolvedDeskArea[] {
  return (map.deskAreas ?? []).map((area) => {
    const { seats, desks } = deskAreaMembers(area, instances, catalog, geometry);
    const violation: DeskViolation | null =
      seats.length > 1 ? 'multiple-seats' : desks.length > 1 ? 'multiple-desks' : null;
    return {
      id: area.id,
      label: area.label ?? 'Desk',
      min: area.min,
      max: area.max,
      seatInstanceId: violation === null ? (seats[0]?.id ?? null) : null,
      violation,
    };
  });
}
