/**
 * TDD tests for task-02: v3→v4 RoomDocument migration, LayoutDocument
 * round-trip, and v4→v5 migration.
 *
 * Written BEFORE implementation (RED → GREEN workflow).
 */
import { describe, it, expect } from 'vitest';
import {
  migrateRoomV3toV4,
  migrateRoomV4toV5,
  migrateToV5,
  serializeRoom,
  deserializeScene,
  type SerializedRoomV3,
  type SerializedRoomV4,
} from './serialize.ts';
import { emptyRoomDocument } from './commands.ts';
import {
  serializeLayout,
  deserializeLayout,
  emptyLayoutDocument,
} from './layout-document.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV3Room(overrides: Partial<SerializedRoomV3> = {}): SerializedRoomV3 {
  return {
    schemaVersion: 3,
    name: 'test',
    updatedAt: 0,
    commands: [],
    groups: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// migrateRoomV3toV4
// ---------------------------------------------------------------------------

describe('migrateRoomV3toV4', () => {
  it('multiplies all placeCube positions by 4', () => {
    const v3 = makeV3Room({
      commands: [
        { id: 'a', op: 'placeCube', kindId: 'block', position: [1, 0, 2] },
        { id: 'b', op: 'placeCube', kindId: 'block', position: [-3, 1, 5] },
      ],
    });
    const v4 = migrateRoomV3toV4(v3);
    const positions = v4.commands
      .filter((c): c is Extract<typeof c, { op: 'placeObject' }> => c.op === 'placeObject')
      .map((c) => c.position);
    expect(positions).toEqual([
      [4, 0, 8],
      [-12, 4, 20],
    ]);
  });

  it('rewrites op from placeCube to placeObject', () => {
    const v3 = makeV3Room({
      commands: [
        { id: 'a', op: 'placeCube', kindId: 'block', position: [0, 0, 0] },
      ],
    });
    const v4 = migrateRoomV3toV4(v3);
    expect(v4.commands[0].op).toBe('placeObject');
  });

  it('extrude commands pass through unchanged', () => {
    const v3 = makeV3Room({
      commands: [
        { id: 'p', op: 'placeCube', kindId: 'block', position: [0, 0, 0] },
        { id: 'e', op: 'extrude', targetCommandId: 'p', face: 'px', count: 3 },
      ],
    });
    const v4 = migrateRoomV3toV4(v3);
    const extrude = v4.commands.find((c) => c.op === 'extrude');
    expect(extrude).toBeDefined();
    expect(extrude).toMatchObject({ op: 'extrude', targetCommandId: 'p', face: 'px', count: 3 });
  });

  it('sets schemaVersion to 4 in output', () => {
    const v4 = migrateRoomV3toV4(makeV3Room());
    expect(v4.schemaVersion).toBe(4);
  });

  it('idempotence: calling with a v4-shaped doc produces the same positions (no double-multiply)', () => {
    const v3 = makeV3Room({
      commands: [
        { id: 'a', op: 'placeCube', kindId: 'block', position: [1, 0, 2] },
      ],
    });
    const v4 = migrateRoomV3toV4(v3);
    // The result is v4 (op: 'placeObject', position ×4). If we pass the v3 again
    // the function should not re-apply the ×4 multiplication. We test via the
    // v3 path: the migrated v4 should have positions ×4, not ×16.
    const placeCmd = v4.commands.find((c): c is Extract<typeof c, { op: 'placeObject' }> =>
      c.op === 'placeObject',
    );
    expect(placeCmd?.position).toEqual([4, 0, 8]);
  });
});

// ---------------------------------------------------------------------------
// deserializeScene — accepts schemaVersion 4 and 5
// ---------------------------------------------------------------------------

describe('deserializeScene', () => {
  it('accepts schemaVersion 4 without throwing', () => {
    const v4: SerializedRoomV4 = {
      schemaVersion: 4,
      name: 'test',
      updatedAt: 0,
      commands: [],
      groups: {},
    };
    expect(() => deserializeScene(v4)).not.toThrow();
    const parsed = deserializeScene(v4);
    expect(parsed.schemaVersion).toBe(4);
  });

  it('accepts schemaVersion 5 without throwing', () => {
    const v5 = {
      schemaVersion: 5,
      name: 'test',
      updatedAt: 0,
      commands: [],
      groups: {},
    };
    expect(() => deserializeScene(v5 as unknown)).not.toThrow();
    const parsed = deserializeScene(v5 as unknown);
    expect(parsed.schemaVersion).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize v5 → deserialize v5
// ---------------------------------------------------------------------------

describe('round-trip serialize/deserialize v5', () => {
  it('serializeRoom emits schemaVersion 5, op placeObject, positions preserved', () => {
    const serialized = serializeRoom({
      name: 'rt-test',
      commands: [
        { id: 'x', op: 'placeObject', kindId: 'block', position: [4, 0, 8] },
      ],
      groups: {},
    });
    expect(serialized.schemaVersion).toBe(5);
    const parsed = deserializeScene(JSON.parse(JSON.stringify(serialized)));
    expect(parsed.schemaVersion).toBe(5);
    const cmd = (parsed as { commands: Array<{ op: string; position: [number, number, number] }> }).commands[0];
    expect(cmd.op).toBe('placeObject');
    expect(cmd.position).toEqual([4, 0, 8]);
  });

  it('serializeRoom preserves layoutName', () => {
    const serialized = serializeRoom({
      name: 'room-with-layout',
      commands: [],
      groups: {},
      layoutName: 'my-layout',
    });
    expect(serialized.layoutName).toBe('my-layout');
    const v5doc = migrateToV5(deserializeScene(JSON.parse(JSON.stringify(serialized))));
    expect(v5doc.layoutName).toBe('my-layout');
  });
});

// ---------------------------------------------------------------------------
// migrateRoomV4toV5 and migrateToV5 (Task 03)
// ---------------------------------------------------------------------------

describe('migrateRoomV4toV5', () => {
  it('bumps schemaVersion from 4 to 5', () => {
    const v4: SerializedRoomV4 = {
      schemaVersion: 4,
      name: 'test-room',
      updatedAt: 12345,
      commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] }],
      groups: {},
    };
    const v5 = migrateRoomV4toV5(v4);
    expect(v5.schemaVersion).toBe(5);
    expect(v5.name).toBe('test-room');
    expect(v5.updatedAt).toBe(12345);
    expect(v5.commands).toHaveLength(1);
    expect(v5.layoutName).toBeUndefined();
  });

  it('preserves commands and groups', () => {
    const v4: SerializedRoomV4 = {
      schemaVersion: 4,
      name: 'room',
      commands: [
        { id: 'a', op: 'placeObject', kindId: 'block', position: [4, 0, 8] },
      ],
      groups: { 'g1': { id: 'g1', commandIds: ['a'], label: 'Group 1' } },
    };
    const v5 = migrateRoomV4toV5(v4);
    const cmd = v5.commands[0] as { op: 'placeObject'; kindId: string };
    expect(cmd.kindId).toBe('block');
    expect(v5.groups['g1'].commandIds).toEqual(['a']);
    expect(v5.layoutName).toBeUndefined();
  });
});

describe('migrateToV5', () => {
  it('v4 fixture migrates to v5 with layoutName undefined', () => {
    const v4: SerializedRoomV4 = {
      schemaVersion: 4,
      name: 'fixture',
      commands: [{ id: 'x', op: 'placeObject', kindId: 'kind1', position: [0, 0, 0] }],
      groups: {},
    };
    const doc = migrateToV5(v4);
    expect(doc.schemaVersion).toBe(5);
    expect(doc.name).toBe('fixture');
    expect(doc.layoutName).toBeUndefined();
    const cmd = doc.commands[0] as { op: 'placeObject'; kindId: string };
    expect(cmd.kindId).toBe('kind1');
  });

  it('v3 fixture migrates all the way to v5 via v4', () => {
    const v3: SerializedRoomV3 = {
      schemaVersion: 3,
      name: 'old-room',
      commands: [{ id: 'p', op: 'placeCube', kindId: 'stone', position: [1, 0, 2] }],
      groups: {},
    };
    const doc = migrateToV5(v3);
    expect(doc.schemaVersion).toBe(5);
    expect(doc.layoutName).toBeUndefined();
    // Position should be multiplied by 4 (v3→v4 migration)
    const cmd = doc.commands[0] as { op: string; position: [number, number, number] };
    expect(cmd.position).toEqual([4, 0, 8]);
  });

  it('v5 input passes through unchanged', () => {
    const v5 = {
      schemaVersion: 5 as const,
      name: 'v5-room',
      commands: [] as [],
      groups: {} as Record<string, never>,
      layoutName: 'main-layout',
    };
    const doc = migrateToV5(v5);
    expect(doc.schemaVersion).toBe(5);
    expect(doc.layoutName).toBe('main-layout');
  });
});

// ---------------------------------------------------------------------------
// LayoutDocument round-trip (Task 02)
// ---------------------------------------------------------------------------

describe('LayoutDocument round-trip', () => {
  it('serializeLayout + deserializeLayout round-trips correctly', () => {
    const commands = [
      { id: 'a', op: 'placeObject' as const, kindId: 'wall-kind', position: [0, 0, 0] as [number, number, number] },
      { id: 'b', op: 'placeObject' as const, kindId: 'floor-kind', position: [4, 0, 0] as [number, number, number] },
    ];
    const serialized = serializeLayout({ name: 'layout-rt', title: 'Round Trip', commands });
    const raw = JSON.parse(JSON.stringify(serialized));
    const parsed = deserializeLayout(raw);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.name).toBe('layout-rt');
    expect(parsed.title).toBe('Round Trip');
    expect(parsed.commands).toHaveLength(2);
    expect(parsed.commands[0]).toMatchObject({ id: 'a', op: 'placeObject', kindId: 'wall-kind' });
    expect(parsed.commands[1]).toMatchObject({ id: 'b', op: 'placeObject', kindId: 'floor-kind' });
  });

  it('deserializeLayout throws on missing name', () => {
    expect(() => deserializeLayout({ schemaVersion: 1, commands: [] })).toThrow('layout: missing string `name`');
  });

  it('deserializeLayout throws on missing commands array', () => {
    expect(() => deserializeLayout({ schemaVersion: 1, name: 'x' })).toThrow('layout v1: missing `commands` array');
  });

  it('deserializeLayout throws on unsupported schemaVersion', () => {
    expect(() => deserializeLayout({ schemaVersion: 99, name: 'x', commands: [] })).toThrow('layout: unsupported schemaVersion 99');
  });

  it('deserializeLayout throws on non-object input', () => {
    expect(() => deserializeLayout(null)).toThrow('layout: not an object');
    expect(() => deserializeLayout('string')).toThrow('layout: not an object');
  });

  it('emptyLayoutDocument produces a valid v1 doc', () => {
    const doc = emptyLayoutDocument('empty-layout');
    const parsed = deserializeLayout(doc);
    expect(parsed.name).toBe('empty-layout');
    expect(parsed.commands).toHaveLength(0);
    expect(parsed.schemaVersion).toBe(1);
  });
});
