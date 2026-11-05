import { describe, expect, it } from 'vitest';
import { computeBuildingFootprint } from '../building-footprint.ts';
import { createDefaultApi } from '../create-default-api.ts';
import { computeVoiceZones } from '../voice-zones.ts';
import {
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
  type RoomInstance,
} from '../../scenes/index.ts';

const api = createDefaultApi({ fetcher: async () => new Response('{}', { status: 404 }) });

const hall = emptyRoomDocument('hall');
hall.commands.push(
  newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }),
  newPlaceObject({ kindId: 'colored_block_blue', position: [3, 0, 0] }),
);
const rooms = new Map([['hall', hall]]);

function footprint(placements: RoomInstance[]) {
  const map = { ...emptyMapDocument('m'), rooms: placements };
  const { instances } = api.rooms.compileMap(map, rooms, new Map());
  return computeBuildingFootprint(map, instances, api.geometry);
}

describe('computeBuildingFootprint', () => {
  it('returns one rect per flagged room, bounded like the same room as a voice zone', () => {
    const placements: RoomInstance[] = [
      { id: 'a', roomName: 'hall', position: [0, 0, 0], building: true },
      { id: 'b', roomName: 'hall', position: [20, 0, 0], building: true },
      { id: 'c', roomName: 'hall', position: [40, 0, 0] },
    ];
    const zones = computeVoiceZones(
      { ...emptyMapDocument('m'), rooms: placements.map((p) => ({ ...p, voiceZone: true })) },
      rooms,
      new Map(),
      api.rooms,
      api.geometry,
    );
    expect(footprint(placements)).toEqual(zones.slice(0, 2).map(({ min, max }) => ({ min, max })));
  });

  it('is empty when no room is flagged', () => {
    expect(footprint([{ id: 'a', roomName: 'hall', position: [0, 0, 0] }])).toEqual([]);
  });
});
