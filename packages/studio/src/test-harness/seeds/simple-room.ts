import {
  emptyRoomDocument,
  newPlaceObject,
  type RoomDocument,
} from '@officexr/world/scenes';

/**
 * A small room: a 2×2 footprint of blue blocks at y=0. Enough geometry
 * for the renderer to produce instances and a non-degenerate AABB, so
 * selection-outline and snap scenarios have something to act on.
 */
export function simpleRoomSeed(name = 'test-room'): RoomDocument {
  const doc = emptyRoomDocument(name, name);
  doc.commands = [
    newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }),
    newPlaceObject({ kindId: 'colored_block_blue', position: [1, 0, 0] }),
    newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 1] }),
    newPlaceObject({ kindId: 'colored_block_blue', position: [1, 0, 1] }),
  ];
  return doc;
}
