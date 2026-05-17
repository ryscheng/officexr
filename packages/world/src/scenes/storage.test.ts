import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageSceneStorage } from './localstorage-storage.ts';
import {
  serializeScene,
  serializeSceneV1,
  deserializeScene,
  migrateToV2,
} from './serialize.ts';
import { isValidSceneName } from './storage.ts';
import { newPlaceObject } from './commands.ts';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null;
  }
}

describe('isValidSceneName', () => {
  it('accepts plain slug-style names', () => {
    expect(isValidSceneName('default')).toBe(true);
    expect(isValidSceneName('my-room.v2')).toBe(true);
    expect(isValidSceneName('A_b-1')).toBe(true);
  });

  it('rejects empty, too-long, or special-char names', () => {
    expect(isValidSceneName('')).toBe(false);
    expect(isValidSceneName('foo/bar')).toBe(false);
    expect(isValidSceneName('..')).toBe(false);
    expect(isValidSceneName('x'.repeat(65))).toBe(false);
  });
});

describe('serializeScene + deserializeScene (v2 default)', () => {
  it('round-trips a v2 command-list scene', () => {
    const out = serializeScene({
      name: 'kitchen',
      title: 'Kitchen',
      commands: [newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] })],
    });
    expect(out.schemaVersion).toBe(2);
    expect(out.name).toBe('kitchen');
    expect(out.commands).toHaveLength(1);
    const back = deserializeScene(JSON.parse(JSON.stringify(out)));
    expect(back).toEqual(out);
  });

  it('round-trips a v1 worldMap scene through serializeSceneV1', () => {
    const out = serializeSceneV1({
      name: 'kitchen',
      worldMap: {
        gridSize: 10,
        cubeSize: 2,
        origin: { x: 0, z: 0 },
        layers: [],
        kinds: { floor: { id: 'floor', walkable: true } },
      },
    });
    expect(out.schemaVersion).toBe(1);
    expect(out.name).toBe('kitchen');
    expect(out.spawnPoints).toEqual([{ x: 0, y: 0, z: 0 }]);
    const back = deserializeScene(JSON.parse(JSON.stringify(out)));
    expect(back).toEqual(out);
  });

  it('refuses unknown schemaVersion', () => {
    expect(() =>
      deserializeScene({ schemaVersion: 99, name: 'x' }),
    ).toThrow(/schemaVersion 99/);
  });

  it('refuses missing required fields per version', () => {
    expect(() => deserializeScene({})).toThrow();
    expect(() => deserializeScene({ schemaVersion: 1, name: 'x' })).toThrow(
      /worldMap/,
    );
    expect(() => deserializeScene({ schemaVersion: 2, name: 'x' })).toThrow(
      /commands/,
    );
  });
});

describe('migrateToV2', () => {
  it('passes v2 docs through unchanged', () => {
    const v2 = serializeScene({
      name: 'foo',
      commands: [newPlaceObject({ kindId: 'colored_block_blue', position: [1, 0, 0] })],
    });
    const migrated = migrateToV2(v2);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.commands).toEqual(v2.commands);
  });

  it('emits one placeCube per cell from v1 layers', () => {
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
    const migrated = migrateToV2(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.commands).toHaveLength(2);
    expect(migrated.commands[0]).toMatchObject({
      op: 'placeCube',
      kindId: 'wall',
      position: [0, 0, 0],
    });
    expect(migrated.commands[1]).toMatchObject({
      op: 'placeCube',
      kindId: 'wall',
      position: [1, 0, 1],
    });
  });
});

describe('LocalStorageSceneStorage', () => {
  let storage: LocalStorageSceneStorage;
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    storage = new LocalStorageSceneStorage({ storage: mem });
  });

  const sample = serializeScene({
    name: 'living-room',
    title: 'Living Room',
    commands: [
      newPlaceObject({ kindId: 'colored_block_blue', position: [0, 0, 0] }),
    ],
  });

  it('save → load round-trips', async () => {
    await storage.save('living-room', sample);
    const back = await storage.load('living-room');
    expect(back?.name).toBe('living-room');
    expect(back?.schemaVersion).toBe(2);
    if (back?.schemaVersion === 2) {
      expect(back.commands).toHaveLength(1);
    }
  });

  it('list returns the saved scenes', async () => {
    await storage.save('living-room', sample);
    await storage.save('kitchen', { ...sample, name: 'kitchen' });
    const summaries = await storage.list();
    const names = summaries.map((s) => s.name).sort();
    expect(names).toEqual(['kitchen', 'living-room']);
  });

  it('load returns null for an unknown name', async () => {
    expect(await storage.load('made-up')).toBeNull();
  });

  it('delete removes the scene from list and load', async () => {
    await storage.save('living-room', sample);
    await storage.delete('living-room');
    expect(await storage.load('living-room')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('rejects invalid names', async () => {
    await expect(storage.load('../etc/passwd')).rejects.toThrow();
    await expect(storage.save('foo/bar', sample)).rejects.toThrow();
  });
});
