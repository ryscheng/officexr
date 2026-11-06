import { deskAreaMembers, type ApplicationApi } from '@officexr/world/app';
import type { SerializedMap } from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import { deskAreasOf } from './deskAreaGeometry.ts';

export interface DeskAreaViolation {
  areaId: string;
  label: string;
  /** Human-readable cause, e.g. "2 chairs" or "2 chairs, 2 desks". */
  reason: string;
}

/** Areas holding more than one chair or more than one desk, over the already-compiled map instances. */
export function findDeskAreaViolations(
  doc: SerializedMap,
  instances: WorldObjects['instances'],
  catalog: Pick<ApplicationApi['catalog'], 'getKind'>,
  geometry: Pick<ApplicationApi['geometry'], 'worldAABBOfInstance'>,
): DeskAreaViolation[] {
  return deskAreasOf(doc).flatMap((area) => {
    const { seats, desks } = deskAreaMembers(area, instances, catalog, geometry);
    const causes = [
      seats.length > 1 ? `${seats.length} chairs` : null,
      desks.length > 1 ? `${desks.length} desks` : null,
    ].filter((c) => c !== null);
    return causes.length === 0
      ? []
      : { areaId: area.id, label: area.label ?? `Desk ${area.id}`, reason: causes.join(', ') };
  });
}
