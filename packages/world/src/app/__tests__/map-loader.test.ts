import { describe, expect, it, vi } from 'vitest';
import { createDefaultApi } from '../create-default-api.ts';
import { loadMap, MapNotFoundError } from '../map-loader.ts';
import {
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  emptyLayoutDocument,
  emptyMapDocument,
  emptyRoomDocument,
  newPlaceObject,
} from '../../scenes/index.ts';

function setup() {
  const api = createDefaultApi({
    fetcher: async () => new Response('{}', { status: 404 }),
  });
  const kindId = 'colored_block_blue';

  const commandRoom = emptyRoomDocument('command-room');
  commandRoom.commands.push(newPlaceObject({ kindId, position: [0, 0, 0] }));
  const bakedRoom = emptyRoomDocument('baked-room');
  bakedRoom.layoutName = 'hall';
  const layout = emptyLayoutDocument('hall');
  layout.commands.push(newPlaceObject({ kindId, position: [1, 0, 0] }));
  layout.commands.push(newPlaceObject({ kindId, position: [2, 0, 0] }));

  const map = emptyMapDocument('office');
  map.rooms = [
    { id: 'a', roomName: 'command-room', position: [0, 0, 0], voiceZone: true },
    { id: 'b', roomName: 'baked-room', position: [10, 0, 0], rotationY: 1 },
  ];
  map.spawnPoints = [{ id: 's', position: [1, 2, 3] }];
  const annex = emptyLayoutDocument('annex');
  annex.commands.push(newPlaceObject({ kindId, position: [0, 0, 5] }));
  const mixedRoom = emptyRoomDocument('mixed-room');
  mixedRoom.commands.push(newPlaceObject({ kindId, position: [0, 0, 0] }));
  mixedRoom.layoutName = 'annex';
  const mixed = emptyMapDocument('mixed');
  mixed.rooms = [
    { id: 'b', roomName: 'baked-room', position: [10, 0, 0], rotationY: 1 },
    { id: 'm', roomName: 'mixed-room', position: [30, 0, 0] },
  ];
  const ghostRoom = emptyRoomDocument('ghost-room');
  ghostRoom.layoutName = 'ghost';
  const missing = emptyMapDocument('missing');
  missing.rooms = [{ id: 'g', roomName: 'ghost-room', position: [5, 0, 0] }];
  const legacy = { ...map, name: 'legacy', schemaVersion: 1 as const };
  const twice = emptyMapDocument('twice');
  twice.rooms = [...map.rooms, { id: 'c', roomName: 'baked-room', position: [20, 0, 0] }];

  const deps = {
    storages: {
      maps: new InMemoryMapStorage({
        seed: [
          { name: 'office', doc: map },
          { name: 'legacy', doc: legacy },
          { name: 'twice', doc: twice },
          { name: 'mixed', doc: mixed },
          { name: 'missing', doc: missing },
        ],
      }),
      rooms: new InMemoryRoomStorage({
        seed: [
          { name: 'command-room', doc: commandRoom },
          { name: 'baked-room', doc: bakedRoom },
          { name: 'mixed-room', doc: mixedRoom },
          { name: 'ghost-room', doc: ghostRoom },
        ],
      }),
      layouts: new InMemoryLayoutStorage({
        seed: [
          { name: 'hall', doc: layout },
          { name: 'annex', doc: annex },
        ],
      }),
    },
    catalog: api.catalog,
    roomService: api.rooms,
    geometry: api.geometry,
  };
  return deps;
}

describe('loadMap', () => {
  it('compiles command rooms and layout-backed rooms', async () => {
    const loaded = await loadMap(setup(), 'office');
    expect(loaded.mapDoc.name).toBe('office');
    expect([...loaded.rooms.keys()].sort()).toEqual(['baked-room', 'command-room']);
    expect(loaded.worldObjects.instances).toHaveLength(3);
    expect(loaded.spawnPoints).toEqual([{ id: 's', position: [1, 2, 3] }]);
    expect(loaded.bakedLayouts).toEqual([
      { roomInstanceId: 'b', layoutName: 'hall', position: [10, 0, 0], rotationY: 1 },
    ]);
  });

  it('returns a placement for every room linking a layout, including rooms with commands', async () => {
    const loaded = await loadMap(setup(), 'mixed');
    expect(loaded.bakedLayouts).toEqual([
      { roomInstanceId: 'b', layoutName: 'hall', position: [10, 0, 0], rotationY: 1 },
      { roomInstanceId: 'm', layoutName: 'annex', position: [30, 0, 0], rotationY: 0 },
    ]);
    const ids = loaded.worldObjects.instances.map((i) => i.id);
    expect(ids.filter((id) => id.startsWith('m/layout/'))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith('m/') && !id.startsWith('m/layout/'))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith('b/layout/'))).toHaveLength(2);
  });

  it('still lists the placement of a room whose layout fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = await loadMap(setup(), 'missing');
    expect(loaded.worldObjects.instances).toEqual([]);
    expect(loaded.bakedLayouts).toEqual([
      { roomInstanceId: 'g', layoutName: 'ghost', position: [5, 0, 0], rotationY: 0 },
    ]);
    warn.mockRestore();
  });

  it('has no placements when no room links a layout', async () => {
    const deps = setup();
    const plain = emptyMapDocument('plain');
    plain.rooms = [{ id: 'a', roomName: 'command-room', position: [0, 0, 0] }];
    await deps.storages.maps.save('plain', plain);
    expect((await loadMap(deps, 'plain')).bakedLayouts).toEqual([]);
  });

  it('computes voice zones from the compile it returns, compiling once', async () => {
    const deps = setup();
    let compiles = 0;
    const roomService = {
      compileMap: (...args: Parameters<typeof deps.roomService.compileMap>) => {
        compiles += 1;
        return deps.roomService.compileMap(...args);
      },
    };
    const loaded = await loadMap({ ...deps, roomService }, 'office');
    expect(loaded.voiceZones.map((z) => z.id)).toEqual(['a']);
    expect(compiles).toBe(1);
  });

  it('migrates a v1 map, moving its baked placement to where v1 rendered it', async () => {
    const loaded = await loadMap(setup(), 'legacy');
    expect(loaded.mapDoc.schemaVersion).toBe(2);
    expect(loaded.bakedLayouts).toMatchObject([{ position: [0, 0, 0], rotationY: 0 }]);
    expect(loaded.mapDoc.rooms[0].position).toEqual([0, 0, 0]);
  });

  it('lists every placement of a layout placed twice', async () => {
    const loaded = await loadMap(setup(), 'twice');
    expect(loaded.bakedLayouts.map((p) => [p.roomInstanceId, p.layoutName])).toEqual([
      ['b', 'hall'],
      ['c', 'hall'],
    ]);
  });

  it('throws MapNotFoundError for a missing map', async () => {
    await expect(loadMap(setup(), 'nope')).rejects.toBeInstanceOf(MapNotFoundError);
  });
});
