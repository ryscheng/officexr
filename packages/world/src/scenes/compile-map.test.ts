import { describe, expect, it } from 'vitest';
import { compileMap, type LayoutResolver } from './compile-map.ts';
import { compileScene } from './compile.ts';
import { newPlaceObject, type RoomDocument, type SceneCommand } from './commands.ts';
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

// ---------------------------------------------------------------------------
// Layout resolution tests (task-13: baked-only room geometry for bots)
// ---------------------------------------------------------------------------

function bakedRoom(name: string, layoutName: string): RoomDocument {
  return {
    schemaVersion: 5,
    name,
    title: name,
    updatedAt: 0,
    commands: [],
    groups: {},
    layoutName,
  };
}

function layoutWithCubes(
  cubes: Array<[number, number, number]>,
): { commands: SceneCommand[] } {
  return {
    commands: cubes.map((p) =>
      newPlaceObject({ kindId: 'colored_block_blue', position: p }),
    ),
  };
}

describe('compileMap — layout resolution (task-13)', () => {
  it('without getLayout, a baked-only room yields no instances (back-compat)', () => {
    const room = bakedRoom('baked-r', 'my-layout');
    const layout = layoutWithCubes([[0, 0, 0], [1, 0, 0]]);
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'inst', roomName: 'baked-r', position: [0, 0, 0] }],
    };
    // No getLayout supplied — existing behavior unchanged.
    const compiled = compileMap(map, new Map([['baked-r', room]]), 2);
    expect(compiled.instances).toHaveLength(0);
    // Sanity: the layout has 2 cubes, so if the resolver leaked through it
    // would produce 2 instances. Empty confirms back-compat.
    void layout; // layout in scope to make the test intent explicit
  });

  it('with getLayout that returns a layout, a baked-only room yields the layout instances', () => {
    const room = bakedRoom('baked-r', 'my-layout');
    const layout = layoutWithCubes([[0, 0, 0], [1, 0, 0]]);
    const getLayout: LayoutResolver = (name) =>
      name === 'my-layout' ? layout : undefined;
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'inst', roomName: 'baked-r', position: [0, 0, 0] }],
    };
    const compiled = compileMap(map, new Map([['baked-r', room]]), 2, undefined, getLayout);
    expect(compiled.instances).toHaveLength(2);
    // IDs must be namespaced with the room instance id (same as inline rooms).
    for (const i of compiled.instances) {
      expect(i.id.startsWith('inst/')).toBe(true);
    }
    const positions = compiled.instances.map((i) => i.position).sort();
    expect(positions).toEqual([[0, 0, 0], [1, 0, 0]].sort());
  });

  it('with getLayout, a room that has inline commands uses its OWN commands (not the layout)', () => {
    // A room with inline commands should NOT be replaced by the layout even
    // if layoutName is set and getLayout returns something.
    const room: RoomDocument = {
      schemaVersion: 5,
      name: 'inline-r',
      title: 'inline-r',
      updatedAt: 0,
      commands: [newPlaceObject({ kindId: 'block', position: [5, 0, 0] })],
      groups: {},
      layoutName: 'my-layout',
    };
    const layout = layoutWithCubes([[0, 0, 0], [1, 0, 0]]);
    const getLayout: LayoutResolver = () => layout;
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'inst', roomName: 'inline-r', position: [0, 0, 0] }],
    };
    const compiled = compileMap(map, new Map([['inline-r', room]]), 2, undefined, getLayout);
    // Only the 1 inline cube, NOT the 2 layout cubes.
    expect(compiled.instances).toHaveLength(1);
    expect(compiled.instances[0].position).toEqual([5, 0, 0]);
  });

  it('with getLayout that returns undefined for the layout name, emits a warning and yields no instances', () => {
    const room = bakedRoom('baked-r', 'missing-layout');
    const getLayout: LayoutResolver = () => undefined;
    const warnCalls: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnCalls.push(String(args[0]));
    try {
      const map: MapDocumentV1 = {
        ...emptyMapDocument('m'),
        rooms: [{ id: 'inst', roomName: 'baked-r', position: [0, 0, 0] }],
      };
      const compiled = compileMap(map, new Map([['baked-r', room]]), 2, undefined, getLayout);
      expect(compiled.instances).toHaveLength(0);
      expect(warnCalls.some((m) => m.includes('missing-layout'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('layout instances apply the same room-instance rotation as inline rooms', () => {
    // A single layout cube at (1,0,0). rotationY=1 (+90°): (x,z)→(z,-x) → (0,0,-1).
    // Translated by instance position (5,0,5) → (5,0,4).
    const room = bakedRoom('baked-r', 'my-layout');
    const layout = layoutWithCubes([[1, 0, 0]]);
    const getLayout: LayoutResolver = (name) =>
      name === 'my-layout' ? layout : undefined;
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'inst', roomName: 'baked-r', position: [5, 0, 5], rotationY: 1 }],
    };
    const compiled = compileMap(map, new Map([['baked-r', room]]), 2, undefined, getLayout);
    expect(compiled.instances).toHaveLength(1);
    expect(compiled.instances[0].position).toEqual([5, 0, 4]);
  });

  it('layout resolution + translation mirrors corridor layout exactly', () => {
    // Minimal corridor check: 16 cubes at the scenario-corridor layout positions,
    // placed at room-instance origin (0,0,0) with no rotation.
    const corridorPositions: Array<[number, number, number]> = [
      [0,0,0],[4,0,0],[0,0,4],[4,0,4],[0,0,8],[4,0,8],
      [0,0,12],[4,0,12],[0,0,16],[4,0,16],[0,0,20],[4,0,20],
      [0,0,24],[4,0,24],[0,0,28],[4,0,28],
    ];
    const room = bakedRoom('scenario-corridor', 'scenario-corridor');
    const layout = layoutWithCubes(corridorPositions);
    const getLayout: LayoutResolver = (name) =>
      name === 'scenario-corridor' ? layout : undefined;
    const map: MapDocumentV1 = {
      ...emptyMapDocument('m'),
      rooms: [{ id: 'room-corridor-1', roomName: 'scenario-corridor', position: [0, 0, 0] }],
    };
    const compiled = compileMap(map, new Map([['scenario-corridor', room]]), 0.5, undefined, getLayout);
    expect(compiled.instances).toHaveLength(16);
    const resultPositions = compiled.instances
      .map((i) => i.position)
      .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    const expectedPositions = [...corridorPositions].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    expect(resultPositions).toEqual(expectedPositions);
  });
});
