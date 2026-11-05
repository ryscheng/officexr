import type { FootprintRect } from '@officexr/sdk';
import type { MapDocumentV2 } from '../scenes/index.ts';
import { roomXZBounds, type Instances } from './room-bounds.ts';
import type { InstanceGeometryService } from './types.ts';

/** One XZ rect per `building` placement; empty when none is flagged. */
export function computeBuildingFootprint(
  map: MapDocumentV2,
  instances: Instances,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): FootprintRect[] {
  return map.rooms
    .filter((ri) => ri.building === true)
    .flatMap((ri) => roomXZBounds(instances, ri.id, geometry) ?? []);
}
