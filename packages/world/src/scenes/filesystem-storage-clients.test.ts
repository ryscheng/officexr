import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesystemRoomStorage } from './filesystem-room-storage.ts';
import { FilesystemMapStorage } from './filesystem-map-storage.ts';
import {
  serializeRoom,
  serializeScene,
  serializeMap,
} from './serialize.ts';
import { newPlaceCube } from './commands.ts';
import { DEFAULT_MAP_ENVIRONMENT } from './map-document.ts';

/**
 * In-memory fetch mock that emulates `vite-plugin-storage.ts`'s
 * `/api/rooms/*` and `/api/maps/*` endpoints. It only implements what
 * the storage clients call, NOT the full middleware surface — the
 * point is to verify the client correctly translates HTTP into
 * typed domain calls, with migration on load.
 */
type Method = 'GET' | 'PUT' | 'DELETE';

interface Server {
  prefix: string;
  listKey: 'rooms' | 'maps';
  docs: Map<string, unknown>;
}

function makeFetchMock(servers: Server[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase() as Method;
    for (const srv of servers) {
      if (url === srv.prefix && method === 'GET') {
        const out = Array.from(srv.docs.entries()).map(([name, doc]) => ({
          name,
          title: (doc as { title?: string }).title,
          updatedAt: (doc as { updatedAt?: number }).updatedAt,
        }));
        return new Response(JSON.stringify({ [srv.listKey]: out }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith(`${srv.prefix}/`)) {
        const slug = decodeURIComponent(url.slice(srv.prefix.length + 1));
        if (method === 'GET') {
          const doc = srv.docs.get(slug);
          if (!doc) return new Response('{}', { status: 404 });
          return new Response(JSON.stringify(doc), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (method === 'PUT') {
          srv.docs.set(slug, JSON.parse(init?.body as string));
          return new Response(null, { status: 204 });
        }
        if (method === 'DELETE') {
          srv.docs.delete(slug);
          return new Response(null, { status: 204 });
        }
      }
    }
    return new Response('{"error":"not handled"}', { status: 500 });
  }) as typeof fetch;
}

describe('FilesystemRoomStorage (mocked /api/rooms)', () => {
  const docs = new Map<string, unknown>();
  let storage: FilesystemRoomStorage;

  beforeEach(() => {
    docs.clear();
    vi.stubGlobal(
      'fetch',
      makeFetchMock([{ prefix: '/api/rooms', listKey: 'rooms', docs }]),
    );
    storage = new FilesystemRoomStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUT → GET round-trips a v5 RoomDocument', async () => {
    const room = serializeRoom({
      name: 'kitchen',
      commands: [newPlaceCube({ kindId: 'colored_block_blue', position: [0, 0, 0] })],
      groups: { 'g-1': { id: 'g-1', commandIds: ['cmd-a'] } },
    });
    await storage.save('kitchen', room);
    const back = await storage.load('kitchen');
    expect(back?.schemaVersion).toBe(5);
    expect(back?.commands).toHaveLength(1);
    expect(back?.groups['g-1']).toBeDefined();
  });

  it('migrates legacy v2 payload to v5 on load', async () => {
    // Simulate an on-disk file that's still v2 (e.g. authored before
    // the schema bump). The client must return v5.
    docs.set(
      'legacy',
      serializeScene({
        name: 'legacy',
        commands: [newPlaceCube({ kindId: 'colored_block_blue' })],
      }),
    );
    const back = await storage.load('legacy');
    expect(back?.schemaVersion).toBe(5);
    expect(back?.groups).toEqual({});
  });

  it('returns null on 404', async () => {
    expect(await storage.load('missing')).toBeNull();
  });

  it('list returns saved summaries', async () => {
    await storage.save(
      'a',
      serializeRoom({ name: 'a', title: 'A', commands: [] }),
    );
    await storage.save(
      'b',
      serializeRoom({ name: 'b', title: 'B', commands: [] }),
    );
    const list = await storage.list();
    expect(list.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('delete removes the doc', async () => {
    await storage.save('x', serializeRoom({ name: 'x', commands: [] }));
    await storage.delete('x');
    expect(await storage.load('x')).toBeNull();
  });

  it('rejects invalid names without making a request', async () => {
    await expect(storage.load('../etc/passwd')).rejects.toThrow(/invalid name/);
  });
});

describe('FilesystemMapStorage (mocked /api/maps)', () => {
  const docs = new Map<string, unknown>();
  let storage: FilesystemMapStorage;

  beforeEach(() => {
    docs.clear();
    vi.stubGlobal(
      'fetch',
      makeFetchMock([{ prefix: '/api/maps', listKey: 'maps', docs }]),
    );
    storage = new FilesystemMapStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUT → GET round-trips a MapDocumentV1', async () => {
    const m = serializeMap({
      name: 'town',
      rooms: [{ id: 'r-1', roomName: 'default-v2', position: [0, 0, 0] }],
      spawnPoints: [{ id: 's-1', position: [0, 0, 0] }],
      environment: { ...DEFAULT_MAP_ENVIRONMENT, sun: { ...DEFAULT_MAP_ENVIRONMENT.sun } },
    });
    await storage.save('town', m);
    const back = await storage.load('town');
    expect(back?.schemaVersion).toBe(1);
    expect(back?.rooms).toHaveLength(1);
  });

  it('throws on malformed payload from server', async () => {
    docs.set('bad', { schemaVersion: 99, name: 'bad' });
    await expect(storage.load('bad')).rejects.toThrow(/schemaVersion 99/);
  });

  it('returns null on 404', async () => {
    expect(await storage.load('missing')).toBeNull();
  });

  it('delete removes the map', async () => {
    await storage.save(
      'x',
      serializeMap({
        name: 'x',
        rooms: [],
        spawnPoints: [],
        environment: { ...DEFAULT_MAP_ENVIRONMENT, sun: { ...DEFAULT_MAP_ENVIRONMENT.sun } },
      }),
    );
    await storage.delete('x');
    expect(await storage.load('x')).toBeNull();
  });
});
