import { describe, expect, it } from 'vitest';
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
    { id: 'a', roomName: 'command-room', position: [0, 0, 0] },
    { id: 'b', roomName: 'baked-room', position: [10, 0, 0] },
  ];
  map.spawnPoints = [{ id: 's', position: [1, 2, 3] }];

  const deps = {
    storages: {
      maps: new InMemoryMapStorage({ seed: [{ name: 'office', doc: map }] }),
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
  });

  it('throws MapNotFoundError for a missing map', async () => {
    await expect(loadMap(setup(), 'nope')).rejects.toBeInstanceOf(MapNotFoundError);
  });
});
