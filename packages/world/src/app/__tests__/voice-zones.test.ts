import { describe, expect, it } from 'vitest';
import { createDefaultApi } from '../create-default-api.ts';
import { computeVoiceZones } from '../voice-zones.ts';
import {
  emptyLayoutDocument,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
  type LayoutDocument,
  type RoomDocument,
  type RoomInstance,
} from '../../scenes/index.ts';

const kindId = 'colored_block_blue';
const api = createDefaultApi({ fetcher: async () => new Response('{}', { status: 404 }) });

function zonesFor(
  placements: RoomInstance[],
  rooms: RoomDocument[],
  layouts: LayoutDocument[] = [],
) {
  const map = { ...emptyMapDocument('m'), rooms: placements };
  return computeVoiceZones(
    map,
    new Map(rooms.map((r) => [r.name, r])),
    new Map(layouts.map((l) => [l.name, l])),
    api.rooms,
    api.geometry,
  );
}

function hall(name = 'hall', title?: string) {
  const room = emptyRoomDocument(name, title);
  room.commands.push(
    newPlaceObject({ kindId, position: [0, 0, 0] }),
    newPlaceObject({ kindId, position: [3, 0, 0] }),
  );
  return room;
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('computeVoiceZones', () => {
  it('bounds a flagged placement by its compiled contents, translated by its position', () => {
    const vs = api.voxelSize;
    const [zone] = zonesFor([{ id: 'z', roomName: 'hall', position: [10, 0, 4], voiceZone: true }], [hall('hall', 'Big Hall')]);
    expect(zone.id).toBe('z');
    expect(zone.label).toBe('Big Hall');
    near(zone.min.x, 10 * vs);
    near(zone.min.z, 4 * vs);
    near(zone.max.x, 14 * vs);
    near(zone.max.z, 5 * vs);
  });

  it('rotates the footprint with the placement', () => {
    const flat = zonesFor([{ id: 'z', roomName: 'hall', position: [0, 0, 0], voiceZone: true }], [hall()])[0];
    const turned = zonesFor([{ id: 'z', roomName: 'hall', position: [0, 0, 0], rotationY: 1, voiceZone: true }], [hall()])[0];
    const flatW = flat.max.x - flat.min.x;
    const flatD = flat.max.z - flat.min.z;
    near(turned.max.x - turned.min.x, flatD);
    near(turned.max.z - turned.min.z, flatW);
  });

  it('compiles a baked-only room from its layout commands', () => {
    const baked = emptyRoomDocument('baked');
    baked.layoutName = 'wing';
    const layout = emptyLayoutDocument('wing');
    layout.commands.push(newPlaceObject({ kindId, position: [0, 0, 0] }), newPlaceObject({ kindId, position: [2, 0, 0] }));
    const [zone] = zonesFor([{ id: 'b', roomName: 'baked', position: [0, 0, 0], voiceZone: true }], [baked], [layout]);
    expect(zone.id).toBe('b');
    near(zone.max.x - zone.min.x, 3 * api.voxelSize);
  });

  it('spans both the own commands and the linked layout of a room that has both', () => {
    const room = hall('both');
    room.layoutName = 'wing';
    const layout = emptyLayoutDocument('wing');
    layout.commands.push(newPlaceObject({ kindId, position: [0, 0, 8] }));
    const [zone] = zonesFor([{ id: 'z', roomName: 'both', position: [0, 0, 0], voiceZone: true }], [room], [layout]);
    near(zone.max.x - zone.min.x, 4 * api.voxelSize);
    near(zone.max.z - zone.min.z, 9 * api.voxelSize);
  });

  it('emits only flagged placements, one per placement of the same room', () => {
    const zones = zonesFor(
      [
        { id: 'a', roomName: 'hall', position: [0, 0, 0], voiceZone: true },
        { id: 'b', roomName: 'hall', position: [20, 0, 0], voiceZone: false },
        { id: 'c', roomName: 'hall', position: [40, 0, 0] },
        { id: 'd', roomName: 'hall', position: [60, 0, 0], voiceZone: true },
      ],
      [hall()],
    );
    expect(zones.map((z) => z.id)).toEqual(['a', 'd']);
  });

  it('skips a flagged placement whose room compiles to nothing', () => {
    expect(
      zonesFor([{ id: 'e', roomName: 'empty', position: [0, 0, 0], voiceZone: true }], [emptyRoomDocument('empty')]),
    ).toEqual([]);
  });
});
