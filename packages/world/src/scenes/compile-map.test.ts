import { describe, expect, it } from 'vitest';
import { compileMap } from './compile-map.ts';
import { compileScene } from './compile.ts';
import { newPlaceObject, type RoomDocument } from './commands.ts';
import { emptyMapDocument, type MapDocumentV1 } from './map-document.ts';

function roomWithCubes(
  name: string,
  cubes: Array<[number, number, number]>,
): RoomDocument {
  return {
    schemaVersion: 5,
    name,
    title: name,
    updatedAt: 0,
    commands: cubes.map((p) => newPlaceObject({ kindId: 'block', position: p })),
    groups: {},
  };
}

describe('compileMap', () => {
  it('returns empty instances when there are no rooms', () => {
    const m = emptyMapDocument('m');
    const compiled = compileMap(m, new Map(), 2);
    expect(compiled.cubeSize).toBe(2);
    expect(compiled.instances).toEqual([]);
  });

  it('single instance at origin equals compileScene of the room', () => {
    const room = roomWithCubes('r1', [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const direct = compileScene(room, 2);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'inst-1', roomName: 'r1', position: [0, 0, 0] }],
    };
    const compiled = compileMap(map, new Map([['r1', room]]), 2);
    expect(compiled.instances).toHaveLength(direct.instances.length);
    // Positions match exactly (id prefixed with the instance id).
    const positions = compiled.instances.map((i) => i.position).sort();
    const expected = direct.instances.map((i) => i.position).sort();
    expect(positions).toEqual(expected);
    for (const inst of compiled.instances) {
      expect(inst.id.startsWith('inst-1/')).toBe(true);
      expect(inst.sourceCommandId.startsWith('inst-1/')).toBe(true);
    }
  });

  it('two instances of the same room at different offsets emit both', () => {
    const room = roomWithCubes('r', [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [
        { id: 'a', roomName: 'r', position: [0, 0, 0] },
        { id: 'b', roomName: 'r', position: [10, 0, 0] },
      ],
    };
    const compiled = compileMap(map, new Map([['r', room]]), 2);
    expect(compiled.instances).toHaveLength(4);
    const positions = compiled.instances.map((i) => i.position).sort();
    expect(positions).toEqual(
      [
        [0, 0, 0],
        [1, 0, 0],
        [10, 0, 0],
        [11, 0, 0],
      ].sort(),
    );
  });

  it('rotationY=1 rotates +90° about Y around the room-local origin', () => {
    // A two-cube room along +X: (0,0,0) and (1,0,0).
    // rotationY=1 (+90° about Y): (x,z)→(z,-x), so (0,0,0)→(0,0,0),
    // (1,0,0)→(0,0,-1). Then translate by (5,0,5) →
    // (5,0,5) and (5,0,4).
    const room = roomWithCubes('r', [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'i', roomName: 'r', position: [5, 0, 5], rotationY: 1 }],
    };
    const compiled = compileMap(map, new Map([['r', room]]), 2);
    const positions = compiled.instances.map((i) => i.position).sort();
    expect(positions).toEqual(
      [
        [5, 0, 5],
        [5, 0, 4],
      ].sort(),
    );
  });

  it('rotationY=2 produces 180° rotation', () => {
    const room = roomWithCubes('r', [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'i', roomName: 'r', position: [0, 0, 0], rotationY: 2 }],
    };
    const compiled = compileMap(map, new Map([['r', room]]), 2);
    const positions = compiled.instances.map((i) => i.position).sort();
    expect(positions).toEqual(
      [
        [0, 0, 0],
        [-1, 0, 0],
      ].sort(),
    );
  });

  it('rotationY=3 rotates -90° (or +270°) about Y', () => {
    // (x,z)→(-z,x). (1,0,0)→(0,0,1). (0,0,1)→(-1,0,0).
    const room = roomWithCubes('r', [
      [1, 0, 0],
      [0, 0, 1],
    ]);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'i', roomName: 'r', position: [0, 0, 0], rotationY: 3 }],
    };
    const compiled = compileMap(map, new Map([['r', room]]), 2);
    const positions = compiled.instances.map((i) => i.position).sort();
    expect(positions).toEqual(
      [
        [0, 0, 1],
        [-1, 0, 0],
      ].sort(),
    );
  });

  it('skips RoomInstance with a missing room ref and warns', () => {
    const warn = console.warn;
    const calls: string[] = [];
    console.warn = (msg: string) => calls.push(String(msg));
    try {
      const map: MapDocumentV1 = {
        ...emptyMapDocument('m'),
        rooms: [
          { id: 'orphan', roomName: 'missing', position: [0, 0, 0] },
        ],
      };
      const compiled = compileMap(map, new Map(), 2);
      expect(compiled.instances).toEqual([]);
      expect(calls.some((c) => c.includes('missing room'))).toBe(true);
    } finally {
      console.warn = warn;
    }
  });

  it('preserves kindId from the source room', () => {
    const room: RoomDocument = {
      schemaVersion: 5,
      name: 'r',
      title: 'r',
      updatedAt: 0,
      commands: [
        newPlaceObject({ kindId: 'red', position: [0, 0, 0] }),
        newPlaceObject({ kindId: 'blue', position: [1, 0, 0] }),
      ],
      groups: {},
    };
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'i', roomName: 'r', position: [0, 0, 0] }],
    };
    const compiled = compileMap(map, new Map([['r', room]]), 2);
    const kindIds = compiled.instances.map((i) => i.kindId).sort();
    expect(kindIds).toEqual(['blue', 'red']);
  });
});
