import { describe, expect, it } from 'vitest';
import { emptyRoomDocument } from './commands.ts';
import { emptyMapDocument } from './map-document.ts';
import { groupPlacementsByLayout, mapLayoutPlacements } from './map-layout-placements.ts';

function setup() {
  const hall = { ...emptyRoomDocument('hall'), layoutName: 'hall-layout' };
  const plain = emptyRoomDocument('plain');
  const map = emptyMapDocument('town');
  map.rooms = [
    { id: 'a', roomName: 'hall', position: [0, 0, 0] },
    { id: 'b', roomName: 'plain', position: [5, 0, 0] },
    { id: 'c', roomName: 'hall', position: [9, 0, 0], rotationY: 2 },
    { id: 'd', roomName: 'ghost', position: [1, 0, 0] },
  ];
  const rooms = new Map([[hall.name, hall], [plain.name, plain]]);
  return { map, loadRoom: async (n: string) => rooms.get(n) ?? null };
}

describe('mapLayoutPlacements', () => {
  it('lists a placement per layout-linked room, keeping duplicates, and reports missing rooms', async () => {
    const { map, loadRoom } = setup();
    const { placements, missingRooms } = await mapLayoutPlacements(map, loadRoom);
    expect(placements).toEqual([
      { roomInstanceId: 'a', layoutName: 'hall-layout', position: [0, 0, 0], rotationY: 0 },
      { roomInstanceId: 'c', layoutName: 'hall-layout', position: [9, 0, 0], rotationY: 2 },
    ]);
    expect(missingRooms).toEqual(['ghost']);
  });

  it('treats a room whose load throws as missing', async () => {
    const { map } = setup();
    const { missingRooms } = await mapLayoutPlacements(map, async () => {
      throw new Error('boom');
    });
    expect(missingRooms.sort()).toEqual(['ghost', 'hall', 'plain']);
  });
});

describe('groupPlacementsByLayout', () => {
  it('collects room instance ids per distinct layout', async () => {
    const { map, loadRoom } = setup();
    const { placements } = await mapLayoutPlacements(map, loadRoom);
    expect([...groupPlacementsByLayout(placements)]).toEqual([['hall-layout', ['a', 'c']]]);
  });
});
