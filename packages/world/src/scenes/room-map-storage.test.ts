import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageRoomStorage } from './localstorage-room-storage.ts';
import { LocalStorageMapStorage } from './localstorage-map-storage.ts';
import {
  serializeRoom,
  serializeScene,
  serializeMap,
} from './serialize.ts';
import { newPlaceCube } from './commands.ts';
import { DEFAULT_MAP_ENVIRONMENT } from './map-document.ts';

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

describe('LocalStorageRoomStorage', () => {
  let storage: LocalStorageRoomStorage;
  let mem: MemoryStorage;

  const sample = serializeRoom({
    name: 'kitchen',
    title: 'Kitchen',
    commands: [
      newPlaceCube({ kindId: 'colored_block_blue', position: [0, 0, 0] }),
    ],
    groups: { 'g-1': { id: 'g-1', commandIds: ['cmd-1'] } },
  });

  beforeEach(() => {
    mem = new MemoryStorage();
    storage = new LocalStorageRoomStorage({ storage: mem });
  });

  it('save → load round-trips a v4 RoomDocument', async () => {
    await storage.save('kitchen', sample);
    const back = await storage.load('kitchen');
    expect(back?.name).toBe('kitchen');
    expect(back?.schemaVersion).toBe(4);
    expect(back?.commands).toHaveLength(1);
    expect(back?.groups['g-1'].commandIds).toEqual(['cmd-1']);
  });

  it('list returns the saved rooms', async () => {
    await storage.save('kitchen', sample);
    await storage.save('living-room', { ...sample, name: 'living-room' });
    const summaries = await storage.list();
    expect(summaries.map((s) => s.name).sort()).toEqual(['kitchen', 'living-room']);
  });

  it('load returns null for unknown name', async () => {
    expect(await storage.load('made-up')).toBeNull();
  });

  it('delete removes the room from list and load', async () => {
    await storage.save('kitchen', sample);
    await storage.delete('kitchen');
    expect(await storage.load('kitchen')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('migrates a legacy v2 doc to v4 on load', async () => {
    // Caller wrote a v2 doc directly (e.g. a legacy localStorage entry
    // from before the schema bump). load() must still return v4.
    mem.setItem(
      'officexr:room:legacy',
      JSON.stringify(
        serializeScene({
          name: 'legacy',
          commands: [newPlaceCube({ kindId: 'colored_block_blue' })],
        }),
      ),
    );
    // Touch the index manually so list() can see it; load() never
    // reads the index but our test surfaces the migration regardless.
    mem.setItem(
      'officexr:room:__index__',
      JSON.stringify({ legacy: { updatedAt: Date.now() } }),
    );
    const back = await storage.load('legacy');
    expect(back?.schemaVersion).toBe(4);
    expect(back?.groups).toEqual({});
  });

  it('rejects invalid names', async () => {
    await expect(storage.load('../etc/passwd')).rejects.toThrow();
    await expect(storage.save('foo/bar', sample)).rejects.toThrow();
  });
});

describe('LocalStorageMapStorage', () => {
  let storage: LocalStorageMapStorage;
  let mem: MemoryStorage;

  const sample = serializeMap({
    name: 'town',
    title: 'Town',
    rooms: [{ id: 'r-1', roomName: 'default-v2', position: [0, 0, 0] }],
    spawnPoints: [{ id: 's-1', position: [0, 0, 0] }],
    environment: { ...DEFAULT_MAP_ENVIRONMENT, sun: { ...DEFAULT_MAP_ENVIRONMENT.sun } },
  });

  beforeEach(() => {
    mem = new MemoryStorage();
    storage = new LocalStorageMapStorage({ storage: mem });
  });

  it('save → load round-trips a MapDocumentV1', async () => {
    await storage.save('town', sample);
    const back = await storage.load('town');
    expect(back?.name).toBe('town');
    expect(back?.schemaVersion).toBe(1);
    expect(back?.rooms).toHaveLength(1);
    expect(back?.spawnPoints).toHaveLength(1);
  });

  it('list returns saved maps', async () => {
    await storage.save('town', sample);
    await storage.save('beach', { ...sample, name: 'beach' });
    const summaries = await storage.list();
    expect(summaries.map((s) => s.name).sort()).toEqual(['beach', 'town']);
  });

  it('rejects malformed payload on load', async () => {
    mem.setItem(
      'officexr:map:bad',
      JSON.stringify({ schemaVersion: 99, name: 'bad' }),
    );
    mem.setItem('officexr:map:__index__', JSON.stringify({ bad: { updatedAt: 0 } }));
    await expect(storage.load('bad')).rejects.toThrow(/schemaVersion 99/);
  });

  it('delete clears index and entry', async () => {
    await storage.save('town', sample);
    await storage.delete('town');
    expect(await storage.load('town')).toBeNull();
    expect(await storage.list()).toEqual([]);
  });
});
