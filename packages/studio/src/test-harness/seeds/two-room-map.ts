import {
  emptyMapDocument,
  type MapDocumentV1,
  type RoomDocument,
} from '@officexr/world/scenes';
import { simpleRoomSeed } from './simple-room.ts';

export interface TwoRoomMapSeed {
  map: MapDocumentV1;
  /** Room documents the map's instances reference, ready to seed an
   *  `InMemoryRoomStorage` so the map library can resolve them. */
  rooms: Array<{ name: string; doc: RoomDocument }>;
}

/**
 * A map with two instances of `simpleRoomSeed`, placed with a small gap
 * on X so the Move-tool boundary-snap scenario has something to snap to
 * (room A can be dragged toward room B and clicks flush within the
 * 2-voxel threshold).
 *
 * Room A is at voxel x=0; room B at x=6. Each room's footprint spans 2
 * voxels (x ∈ {0,1}), so B occupies x ∈ {6,7}. Dragging A's right face
 * toward B's left face crosses the snap threshold near x=4.
 */
export function twoRoomMapSeed(name = 'two-room-map'): TwoRoomMapSeed {
  const room = simpleRoomSeed('snap-room');
  const map = emptyMapDocument(name, name);
  map.rooms = [
    { id: 'inst-a', roomName: 'snap-room', position: [0, 0, 0], rotationY: 0 },
    { id: 'inst-b', roomName: 'snap-room', position: [6, 0, 0], rotationY: 0 },
  ];
  return {
    map,
    rooms: [{ name: 'snap-room', doc: room }],
  };
}
