import type { VoiceZone } from '@officexr/sdk';
import type { LayoutDocument, MapDocumentV2, RoomDocument } from '../scenes/index.ts';
import { roomXZBounds } from './room-bounds.ts';
import type { InstanceGeometryService, RoomService } from './types.ts';

/**
 * One zone per `voiceZone` placement, bounded in XZ by the world AABBs of the
 * placement's compiled instances. Zone ids are the placement ids, so every
 * client derives the same call room names from the same map.
 */
export function computeVoiceZones(
  map: MapDocumentV2,
  rooms: ReadonlyMap<string, RoomDocument>,
  layouts: ReadonlyMap<string, LayoutDocument>,
  roomService: Pick<RoomService, 'compileMap'>,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
): VoiceZone[] {
  const flagged = map.rooms.filter((ri) => ri.voiceZone === true);
  if (flagged.length === 0) {
    return [];
  }
  const { instances } = roomService.compileMap(map, rooms, layouts);
  return flagged.flatMap((ri) => {
    const bounds = roomXZBounds(instances, ri.id, geometry);
    return bounds ? { id: ri.id, label: rooms.get(ri.roomName)?.title ?? ri.roomName, ...bounds } : [];
  });
}
