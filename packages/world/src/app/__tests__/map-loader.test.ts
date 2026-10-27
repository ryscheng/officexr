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
        ],
      }),
      rooms: new InMemoryRoomStorage({
        seed: [
          { name: 'command-room', doc: commandRoom },
          { name: 'baked-room', doc: bakedRoom },
        ],
      }),
      layouts: new InMemoryLayoutStorage({
        seed: [{ name: 'hall', doc: layout }],
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
    expect(loaded.bakedLayoutName).toBe('hall');
    expect(loaded.bakedPlacement).toMatchObject({ position: [10, 0, 0], rotationY: 1 });
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
    expect(loaded.bakedPlacement).toMatchObject({ position: [0, 0, 0], rotationY: 0 });
    expect(loaded.mapDoc.rooms[0].position).toEqual([0, 0, 0]);
  });

  it('renders the first of several baked placements, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = await loadMap(setup(), 'twice');
    expect(loaded.bakedPlacement).toMatchObject({ position: [10, 0, 0] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 times'));
    warn.mockRestore();
  });

  it('throws MapNotFoundError for a missing map', async () => {
    await expect(loadMap(setup(), 'nope')).rejects.toBeInstanceOf(MapNotFoundError);
  });
});
