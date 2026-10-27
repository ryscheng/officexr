import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  serializeRoom,
  serializeScene,
  serializeSceneV1,
  serializeMap,
  deserializeScene,
  deserializeMap,
  migrateMapV1toV2,
  migrateToV3,
  migrateToV4,
  migrateToV5,
} from './serialize.ts';
import { isBakedRoom, newPlaceObject } from './commands.ts';
import { deserializeLayout } from './layout-document.ts';
import {
  DEFAULT_MAP_ENVIRONMENT,
  emptyMapDocument,
  type MapDocumentV1,
  type MapDocumentV2,
} from './map-document.ts';

describe('serializeRoom + deserializeScene (v5 RoomDocument)', () => {
  it('round-trips a v5 room with commands and groups', () => {
    const out = serializeRoom({
      name: 'kitchen',
      title: 'Kitchen',
      commands: [newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] })],
      groups: {
        'g-1': { id: 'g-1', commandIds: ['cmd-a', 'cmd-b'], label: 'wall' },
      },
    });
    expect(out.schemaVersion).toBe(5);
    expect(out.name).toBe('kitchen');
    expect(out.commands).toHaveLength(1);
    expect(out.groups['g-1'].commandIds).toEqual(['cmd-a', 'cmd-b']);
    const back = deserializeScene(JSON.parse(JSON.stringify(out)));
    expect(back).toEqual(out);
  });

  it('defaults groups to empty when omitted', () => {
    const out = serializeRoom({
      name: 'kitchen',
      commands: [],
    });
    expect(out.groups).toEqual({});
  });

  it('rejects v3 docs missing groups', () => {
    expect(() =>
      deserializeScene({ schemaVersion: 3, name: 'x', commands: [] }),
    ).toThrow(/groups/);
  });

  it('rejects v3 docs missing commands', () => {
    expect(() =>
      deserializeScene({ schemaVersion: 3, name: 'x', groups: {} }),
    ).toThrow(/commands/);
  });

  it('rejects v4 docs missing groups', () => {
    expect(() =>
      deserializeScene({ schemaVersion: 4, name: 'x', commands: [] }),
    ).toThrow(/groups/);
  });

  it('rejects v4 docs missing commands', () => {
    expect(() =>
      deserializeScene({ schemaVersion: 4, name: 'x', groups: {} }),
    ).toThrow(/commands/);
  });
});

describe('placeObject yawDeg parsing', () => {
  const place = (yawDeg: unknown) => ({
    id: 'p',
    op: 'placeObject',
    kindId: 'wall',
    position: [0, 0, 0],
    yawDeg,
  });
  const parsers = {
    deserializeScene: (commands: unknown[]) =>
      migrateToV5(deserializeScene({ schemaVersion: 5, name: 'r', commands, groups: {} })).commands,
    deserializeLayout: (commands: unknown[]) =>
      deserializeLayout({ schemaVersion: 1, name: 'l', commands }).commands,
  };

  describe.each(Object.entries(parsers))('%s', (_name, parse) => {
    it('normalises yawDeg to [0, 360)', () => {
      expect(parse([place(450)])[0]).toMatchObject({ yawDeg: 90 });
      expect(parse([place(-90)])[0]).toMatchObject({ yawDeg: 270 });
    });

    it.each(['90', null, Number.NaN, Number.POSITIVE_INFINITY])('rejects yawDeg %s', (yaw) => {
      expect(() => parse([place(yaw)])).toThrow(/yawDeg/);
    });

    it('leaves an omitted yawDeg off', () => {
      const { yawDeg: _omitted, ...plain } = place(undefined);
      expect(parse([plain])[0]).not.toHaveProperty('yawDeg');
    });
  });
});

describe('migrateToV4', () => {
  it('downgrades v5 docs to v4 (strips layoutName)', () => {
    const v5 = serializeRoom({
      name: 'foo',
      commands: [newPlaceObject({ kindId: 'colored_block_blue', position: [4, 0, 4] })],
      groups: { 'g-1': { id: 'g-1', commandIds: ['cmd-1'] } },
    });
    const migrated = migrateToV4(v5);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.commands).toEqual(v5.commands);
    expect(migrated.groups).toEqual(v5.groups);
  });

  it('preserves updatedAt across v2 → v4 migration', () => {
    const v2 = serializeScene({ name: 'foo', commands: [] });
    v2.updatedAt = 1700000000000;
    const migrated = migrateToV4(v2);
    expect(migrated.updatedAt).toBe(1700000000000);
  });

  it('migrates v2 → v4 (drops spawnPoints/characterConfigs, applies ×4 to positions)', () => {
    const v2 = serializeScene({
      name: 'foo',
      commands: [newPlaceObject({ kindId: 'colored_block_blue', position: [1, 0, 0] })],
      spawnPoints: [{ x: 5, y: 0, z: 5 }],
      characterConfigs: { Knight: { speedMultiplier: 1.2 } },
    });
    const migrated = migrateToV4(v2);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.groups).toEqual({});
    expect(migrated).not.toHaveProperty('spawnPoints');
    expect(migrated).not.toHaveProperty('characterConfigs');
    // Positions ×4
    expect(migrated.commands[0]).toMatchObject({ op: 'placeObject', position: [4, 0, 0] });
  });

  it('migrates v1 → v4 through the v2 cell-grid path', () => {
    const v1 = serializeSceneV1({
      name: 'kitchen',
      worldMap: {
        gridSize: 10,
        cubeSize: 2,
        origin: { x: 0, z: 0 },
        layers: [
          {
            kind: 'wall',
            cells: [
              { i: 0, j: 0 },
              { i: 1, j: 1 },
            ],
          },
        ],
        kinds: { wall: { id: 'wall', walkable: false } },
      },
    });
    const migrated = migrateToV4(v1);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.commands).toHaveLength(2);
    expect(migrated.commands[0]).toMatchObject({
      op: 'placeObject',
      kindId: 'wall',
      position: [0, 0, 0],  // cell (0,0) → position [0,0,0] × 4 = [0,0,0]
    });
    expect(migrated.commands[1]).toMatchObject({
      op: 'placeObject',
      kindId: 'wall',
      position: [4, 0, 4],  // cell (1,1) → position [1,0,1] × 4 = [4,0,4]
    });
    expect(migrated.groups).toEqual({});
  });
});

describe('migrateToV3 (deprecated — delegates to migrateToV5)', () => {
  it('returns v5 doc now (migrateToV3 upgraded to delegate to migrateToV5)', () => {
    const v3raw = {
      schemaVersion: 3 as const,
      name: 'foo',
      updatedAt: 0,
      commands: [{ id: 'a', op: 'placeCube' as const, kindId: 'block', position: [1, 0, 2] as [number, number, number] }],
      groups: {},
    };
    const migrated = migrateToV3(v3raw);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.commands[0]).toMatchObject({ op: 'placeObject', position: [4, 0, 8] });
  });
});

describe('serializeMap + deserializeMap', () => {
  function makeFullMap(): MapDocumentV2 {
    return serializeMap({
      name: 'town',
      title: 'Town',
      rooms: [
        { id: 'r-1', roomName: 'default-v2', position: [0, 0, 0] },
        { id: 'r-2', roomName: 'default-v2', position: [10, 0, 0], rotationY: 1, voiceZone: true },
      ],
      spawnPoints: [
        { id: 's-1', label: 'front-door', position: [1.5, 0, 1.5] },
        { id: 's-2', position: [11.5, 0, 1.5] },
      ],
      environment: {
        sun: { positionX: 10, positionY: 30, positionZ: 5, color: '#ffeecc', intensity: 1.6 },
        sky: { enabled: true, turbidity: 8, rayleigh: 1.5, inclination: 0.6, azimuth: 0.25 },
        stars: { enabled: true, radius: 200, depth: 50, count: 5000, factor: 4, saturation: 0, fade: true },
        hdri: { url: '/hdri/sunset.hdr', intensity: 1.0, background: false },
        ambientIntensity: 0.2,
      },
    });
  }

  it('round-trips a fully-populated map', () => {
    const m = makeFullMap();
    expect(m.schemaVersion).toBe(2);
    const back = deserializeMap(JSON.parse(JSON.stringify(m)));
    expect(back).toEqual(m);
  });

  it('round-trips voiceZone and rejects a non-boolean one', () => {
    const m = makeFullMap();
    expect(m.rooms[1].voiceZone).toBe(true);
    expect(deserializeMap(JSON.parse(JSON.stringify(m))).rooms[1].voiceZone).toBe(true);
    m.rooms[1].voiceZone = 'yes' as unknown as boolean;
    expect(() => deserializeMap(JSON.parse(JSON.stringify(m)))).toThrow(/voiceZone/);
  });

  it('preserves null sky/stars/hdri across round-trip', () => {
    const m = serializeMap({
      name: 'plain',
      rooms: [],
      spawnPoints: [],
      environment: { ...DEFAULT_MAP_ENVIRONMENT },
    });
    const back = deserializeMap(JSON.parse(JSON.stringify(m)));
    expect(back.environment.sky).toBeNull();
    expect(back.environment.stars).toBeNull();
    expect(back.environment.hdri).toBeNull();
  });

  it('rejects unknown schemaVersion', () => {
    expect(() => deserializeMap({ schemaVersion: 99, name: 'x' })).toThrow(/schemaVersion 99/);
  });

  it('rejects missing required arrays', () => {
    expect(() => deserializeMap({ schemaVersion: 1, name: 'x' })).toThrow();
    expect(() =>
      deserializeMap({ schemaVersion: 1, name: 'x', rooms: [] }),
    ).toThrow(/spawnPoints/);
    expect(() =>
      deserializeMap({ schemaVersion: 1, name: 'x', rooms: [], spawnPoints: [] }),
    ).toThrow(/environment/);
  });

  it('rejects rooms without a string roomName or with a rotationY outside 0-3', () => {
    const map = (room: unknown) => ({ ...emptyMapDocument('x'), rooms: [room] });
    expect(() => deserializeMap(map(null))).toThrow(/roomName/);
    expect(() => deserializeMap(map({ id: 'a', position: [0, 0, 0] }))).toThrow(/roomName/);
    expect(() => deserializeMap(map({ id: 'a', roomName: 'k', position: [0, 0, 0], rotationY: 4 }))).toThrow(/rotationY/);
    expect(() => deserializeMap(map({ id: 'a', roomName: 'k', position: [0, 0, 0], rotationY: 1.5 }))).toThrow(/rotationY/);
    expect(deserializeMap(map({ id: 'a', roomName: 'k', position: [0, 0, 0], rotationY: 3 })).rooms).toHaveLength(1);
  });

  it('emptyMapDocument produces a valid deserializable map', () => {
    const m = emptyMapDocument('blank');
    const back = deserializeMap(JSON.parse(JSON.stringify(m)));
    expect(back.name).toBe('blank');
    expect(back.rooms).toEqual([]);
    expect(back.spawnPoints).toEqual([]);
  });

  it('rotationY is optional on RoomInstance', () => {
    const m = serializeMap({
      name: 'plain',
      rooms: [{ id: 'r-1', roomName: 'k', position: [0, 0, 0] }],
      spawnPoints: [],
      environment: { ...DEFAULT_MAP_ENVIRONMENT },
    });
    const back = deserializeMap(JSON.parse(JSON.stringify(m)));
    expect(back.rooms[0].rotationY).toBeUndefined();
  });
});

describe('migrateMapV1toV2', () => {
  const v1: MapDocumentV1 = {
    ...emptyMapDocument('town'),
    schemaVersion: 1,
    rooms: [
      { id: 'baked', roomName: 'hall', position: [-24, 0, -23], rotationY: 3 },
      { id: 'cubes', roomName: 'kitchen', position: [10, 0, 5], rotationY: 1 },
    ],
    spawnPoints: [{ id: 's', position: [1.5, 0, 1.5] }],
  };
  const migrated = migrateMapV1toV2(v1, (roomName) => roomName === 'hall');

  it('resets an off-origin, rotated baked placement to identity', () => {
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.rooms[0]).toEqual({ id: 'baked', roomName: 'hall', position: [0, 0, 0], rotationY: 0 });
  });

  it('leaves non-baked placements and spawn points untouched', () => {
    expect(migrated.rooms[1]).toEqual(v1.rooms[1]);
    expect(migrated.spawnPoints).toEqual(v1.spawnPoints);
    expect(migrated.environment).toEqual(v1.environment);
  });

  it('deserializeMap passes a v2 map through unchanged', () => {
    const v2 = { ...migrated, rooms: [{ id: 'baked', roomName: 'hall', position: [4, 0, 4], rotationY: 1 }] };
    expect(deserializeMap(JSON.parse(JSON.stringify(v2)))).toEqual(v2);
  });
});

describe('committed maps', () => {
  const worldDir = path.resolve(__dirname, '../..');
  const readJson = (dir: string, name: string): unknown =>
    JSON.parse(readFileSync(path.join(worldDir, dir, `${name}.json`), 'utf8'));
  const mapNames = readdirSync(path.join(worldDir, 'maps'))
    // `pw-test-*` maps are gitignored e2e leftovers.
    .filter((f) => f.endsWith('.json') && !f.startsWith('pw-test-'))
    .map((f) => f.slice(0, -'.json'.length));

  it.each(mapNames)('%s is v2 with every baked placement at identity, as v1 rendered it', (name) => {
    const map = deserializeMap(readJson('maps', name));
    expect(map.schemaVersion).toBe(2);
    for (const ri of map.rooms) {
      if (isBakedRoom(migrateToV5(deserializeScene(readJson('rooms', ri.roomName))))) {
        expect(ri.position).toEqual([0, 0, 0]);
        expect(ri.rotationY ?? 0).toBe(0);
      }
    }
  });
});
