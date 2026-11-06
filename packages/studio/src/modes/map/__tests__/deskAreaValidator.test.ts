import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import {
  emptyMapDocument,
  emptyRoomDocument,
  type RoomDocument,
  type WorldObjectKind,
} from '@officexr/world/scenes';
import { createDeskAreaValidator, type DeskAreaLibrary } from '../deskAreaValidator.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { seat: { offset: { x: 0, y: 0.5, z: 0 }, yawDeg: 0 } },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = {
  worldAABBOfInstance: (i: { position: [number, number, number] }) => ({
    min: [i.position[0] - 0.5, 0, i.position[2] - 0.5],
    max: [i.position[0] + 0.5, 1, i.position[2] + 0.5],
  }),
} as unknown as Parameters<typeof createDeskAreaValidator>[0]['geometry'];

const chair = (id: string, x: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId: 'chair',
  position: [x, 0, 1],
});

function setup(instances: ObjectInstance[]) {
  let compiles = 0;
  const roomService = {
    compileMap: () => {
      compiles++;
      return { cubeSize: 0.5, instances };
    },
  };
  const room: RoomDocument = emptyRoomDocument('r', 'r');
  const loaded: DeskAreaLibrary = {
    rooms: new Map([['r', room]]),
    layouts: new Map(),
    settledRooms: new Set(['r']),
    settledLayouts: new Set(),
  };
  const validator = (over: { catalogReady?: boolean; library?: DeskAreaLibrary } = {}) =>
    createDeskAreaValidator({
      catalogReady: over.catalogReady ?? true,
      roomService,
      catalog,
      geometry,
      library: over.library ?? loaded,
    });
  return { validator, compiles: () => compiles };
}

const doc = {
  ...emptyMapDocument('m'),
  rooms: [{ id: 'p1', roomName: 'r', position: [0, 0, 0] as [number, number, number], rotationY: 0 as const }],
  deskAreas: [{ id: 'a', min: { x: 0, z: 0 }, max: { x: 4, z: 2 } }],
};

describe('createDeskAreaValidator', () => {
  it('reports two chairs in an area once everything is loaded', () => {
    const { validator } = setup([chair('c1', 1), chair('c2', 2)]);
    expect(validator()(doc)).toEqual({
      type: 'checked',
      violations: [{ areaId: 'a', label: 'Desk a', reason: '2 chairs' }],
    });
  });

  it('accepts one chair', () => {
    const { validator } = setup([chair('c1', 1)]);
    expect(validator()(doc)).toEqual({ type: 'checked', violations: [] });
  });

  it('is pending, not valid, while the catalog or a room is still loading', () => {
    const { validator } = setup([chair('c1', 1), chair('c2', 2)]);
    expect(validator({ catalogReady: false })(doc).type).toBe('pending');
    const loading: DeskAreaLibrary = {
      rooms: new Map(),
      layouts: new Map(),
      settledRooms: new Set(),
      settledLayouts: new Set(),
    };
    expect(validator({ library: loading })(doc)).toEqual({ type: 'pending', reason: 'loading rooms' });
  });

  it('stays pending, naming the room, when a room failed to load', () => {
    const { validator } = setup([]);
    const failed: DeskAreaLibrary = {
      rooms: new Map(),
      layouts: new Map(),
      settledRooms: new Set(['r']),
      settledLayouts: new Set(),
    };
    expect(validator({ library: failed })(doc)).toEqual({ type: 'pending', reason: 'could not load r' });
  });

  it('needs no rooms to accept a map without desk areas', () => {
    const { validator } = setup([]);
    expect(validator({ catalogReady: false })({ ...doc, deskAreas: [] })).toEqual({
      type: 'checked',
      violations: [],
    });
  });

  it('recompiles only when the placements change', () => {
    const { validator, compiles } = setup([chair('c1', 1)]);
    const check = validator();
    check(doc);
    check({ ...doc, deskAreas: [{ ...doc.deskAreas[0], label: 'Pod' }] });
    expect(compiles()).toBe(1);
    check({ ...doc, rooms: [...doc.rooms] });
    expect(compiles()).toBe(2);
  });
});
