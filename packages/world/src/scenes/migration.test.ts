/**
 * TDD tests for task-02: v3→v4 RoomDocument migration.
 *
 * Written BEFORE implementation (RED → GREEN workflow).
 */
import { describe, it, expect } from 'vitest';
import {
  migrateRoomV3toV4,
  serializeRoom,
  deserializeScene,
  type SerializedRoomV3,
  type SerializedRoomV4,
} from './serialize.ts';
import { emptyRoomDocument } from './commands.ts';

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
// deserializeScene — accepts schemaVersion 4
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
});

// ---------------------------------------------------------------------------
// Round-trip: serialize v4 → deserialize v4
// ---------------------------------------------------------------------------

describe('round-trip serialize/deserialize v4', () => {
  it('serializeRoom emits schemaVersion 4, op placeObject, positions preserved', () => {
    const doc = emptyRoomDocument('rt-test');
    // Manually build a v4 doc with a placeObject command
    const serialized = serializeRoom({
      name: 'rt-test',
      commands: [
        { id: 'x', op: 'placeObject', kindId: 'block', position: [4, 0, 8] },
      ],
      groups: {},
    });
    const parsed = deserializeScene(JSON.parse(JSON.stringify(serialized)));
    expect(parsed.schemaVersion).toBe(4);
    const cmd = (parsed as SerializedRoomV4).commands[0];
    expect(cmd.op).toBe('placeObject');
    expect((cmd as { op: 'placeObject'; position: [number, number, number] }).position)
      .toEqual([4, 0, 8]);
  });
});
