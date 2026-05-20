/**
 * Cross-implementation conformance suite.
 *
 * The hazard with an in-memory test double is that it quietly drifts
 * from the real storage it stands in for — a test passes against the
 * fake but the same code fails in production. To prevent that, this
 * suite runs ONE behavioral contract (`runStorageContract`) against
 * every concrete `MapStorage` / `RoomStorage` / `LayoutStorage`
 * implementation: the new `InMemory*` classes and the `Filesystem*`
 * classes (driven by a fetch mock that models the Vite middleware).
 *
 * If the in-memory and filesystem storages disagree on any contract
 * point, this suite goes red — which is the whole point.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FilesystemMapStorage,
  FilesystemRoomStorage,
  FilesystemLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  InMemoryLayoutStorage,
} from './index.ts';
import { serializeRoom, serializeMap } from './serialize.ts';
import { newPlaceCube } from './commands.ts';
import { emptyLayoutDocument } from './layout-document.ts';
import { DEFAULT_MAP_ENVIRONMENT, type MapDocumentV1 } from './map-document.ts';
import type { RoomDocument } from './commands.ts';
import type { LayoutDocument } from './layout-document.ts';

// ---------------------------------------------------------------------------
// Fetch mock modeling the Vite storage middleware
// ---------------------------------------------------------------------------

interface MockBackend {
  /** key: `${basePath}/${name}` → raw stored JSON string */
  files: Map<string, string>;
  /** the JSON envelope key the list endpoint uses (maps/rooms/layouts) */
  listKey: 'maps' | 'rooms' | 'layouts';
  basePath: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Install a `globalThis.fetch` stub that behaves like the dev server's
 * resource middleware for a single resource type:
 *   - GET  {base}            → { [listKey]: SceneSummary[] }
 *   - GET  {base}/:name      → stored JSON, or 404
 *   - PUT  {base}/:name      → stores the body, 200
 *   - DELETE {base}/:name    → removes, 200 (or 404 if absent)
 */
function installFetchMock(backend: MockBackend): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const base = backend.basePath;

      if (url === base && method === 'GET') {
        const summaries = [...backend.files.keys()]
          .filter((k) => k.startsWith(base + '/'))
          .map((k) => {
            const raw = backend.files.get(k)!;
            const doc = JSON.parse(raw) as {
              name: string;
              title?: string;
              updatedAt?: number;
            };
            return { name: doc.name, title: doc.title, updatedAt: doc.updatedAt };
          });
        return jsonResponse({ [backend.listKey]: summaries });
      }

      // Per-resource routes: {base}/:name
      const key = url; // storages encode the full path
      if (method === 'GET') {
        const raw = backend.files.get(key);
        if (raw === undefined) return new Response(null, { status: 404 });
        return jsonResponse(JSON.parse(raw));
      }
      if (method === 'PUT') {
        backend.files.set(key, (init?.body as string) ?? '{}');
        return new Response(null, { status: 200 });
      }
      if (method === 'DELETE') {
        const existed = backend.files.delete(key);
        return new Response(null, { status: existed ? 200 : 404 });
      }
      return new Response(null, { status: 405 });
    }),
  );
}

// ---------------------------------------------------------------------------
// The shared contract
// ---------------------------------------------------------------------------

interface StorageLike<TDoc> {
  list(): Promise<Array<{ name: string }>>;
  load(name: string): Promise<TDoc | null>;
  save(name: string, doc: TDoc): Promise<void>;
  delete(name: string): Promise<void>;
}

interface ContractCase<TDoc> {
  makeStorage(): StorageLike<TDoc>;
  makeDoc(name: string): TDoc;
  /** A stable field used to assert the round-trip preserved content. */
  identity(doc: TDoc): string;
}

function runStorageContract<TDoc>(label: string, c: ContractCase<TDoc>): void {
  describe(label, () => {
    it('load() of a missing name returns null', async () => {
      const s = c.makeStorage();
      expect(await s.load('does-not-exist')).toBeNull();
    });

    it('save() then load() round-trips structurally', async () => {
      const s = c.makeStorage();
      const doc = c.makeDoc('alpha');
      await s.save('alpha', doc);
      const back = await s.load('alpha');
      expect(back).not.toBeNull();
      expect(c.identity(back!)).toBe(c.identity(doc));
    });

    it('list() reflects saved entries', async () => {
      const s = c.makeStorage();
      await s.save('alpha', c.makeDoc('alpha'));
      await s.save('beta', c.makeDoc('beta'));
      const names = (await s.list()).map((e) => e.name).sort();
      expect(names).toEqual(['alpha', 'beta']);
    });

    it('delete() removes an entry', async () => {
      const s = c.makeStorage();
      await s.save('alpha', c.makeDoc('alpha'));
      await s.delete('alpha');
      expect(await s.load('alpha')).toBeNull();
    });

    it('delete() of a missing name does not throw', async () => {
      const s = c.makeStorage();
      await expect(s.delete('ghost')).resolves.toBeUndefined();
    });

    it('rejects invalid names on load/save/delete', async () => {
      const s = c.makeStorage();
      const bad = '../etc/passwd';
      await expect(s.load(bad)).rejects.toThrow();
      await expect(s.save(bad, c.makeDoc('x'))).rejects.toThrow();
      await expect(s.delete(bad)).rejects.toThrow();
    });
  });
}

// ---------------------------------------------------------------------------
// Document factories
// ---------------------------------------------------------------------------

function makeMapDoc(name: string): MapDocumentV1 {
  return serializeMap({
    name,
    title: name,
    rooms: [],
    spawnPoints: [],
    environment: {
      ...DEFAULT_MAP_ENVIRONMENT,
      sun: { ...DEFAULT_MAP_ENVIRONMENT.sun },
    },
  });
}

function makeRoomDoc(name: string): RoomDocument {
  return serializeRoom({
    name,
    title: name,
    commands: [newPlaceCube({ kindId: 'colored_block_blue', position: [0, 0, 0] })],
    groups: {},
  });
}

function makeLayoutDoc(name: string): LayoutDocument {
  return emptyLayoutDocument(name, name);
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MapStorage conformance', () => {
  runStorageContract<MapDocumentV1>('InMemoryMapStorage', {
    makeStorage: () => new InMemoryMapStorage(),
    makeDoc: makeMapDoc,
    identity: (d) => d.name,
  });

  describe('FilesystemMapStorage (fetch-mocked)', () => {
    beforeEach(() => {
      installFetchMock({ files: new Map(), listKey: 'maps', basePath: '/api/maps' });
    });
    runStorageContract<MapDocumentV1>('contract', {
      makeStorage: () => new FilesystemMapStorage(),
      makeDoc: makeMapDoc,
      identity: (d) => d.name,
    });
  });
});

describe('RoomStorage conformance', () => {
  runStorageContract<RoomDocument>('InMemoryRoomStorage', {
    makeStorage: () => new InMemoryRoomStorage(),
    makeDoc: makeRoomDoc,
    identity: (d) => d.name,
  });

  describe('FilesystemRoomStorage (fetch-mocked)', () => {
    beforeEach(() => {
      installFetchMock({ files: new Map(), listKey: 'rooms', basePath: '/api/rooms' });
    });
    runStorageContract<RoomDocument>('contract', {
      makeStorage: () => new FilesystemRoomStorage(),
      makeDoc: makeRoomDoc,
      identity: (d) => d.name,
    });
  });
});

describe('LayoutStorage conformance', () => {
  runStorageContract<LayoutDocument>('InMemoryLayoutStorage', {
    makeStorage: () => new InMemoryLayoutStorage(),
    makeDoc: makeLayoutDoc,
    identity: (d) => d.name,
  });

  describe('FilesystemLayoutStorage (fetch-mocked)', () => {
    beforeEach(() => {
      installFetchMock({
        files: new Map(),
        listKey: 'layouts',
        basePath: '/api/layouts',
      });
    });
    runStorageContract<LayoutDocument>('contract', {
      makeStorage: () => new FilesystemLayoutStorage(),
      makeDoc: makeLayoutDoc,
      identity: (d) => d.name,
    });
  });
});

describe('InMemory seed convenience', () => {
  it('pre-populates documents passed via the constructor seed', async () => {
    const s = new InMemoryMapStorage({
      seed: [{ name: 'preloaded', doc: makeMapDoc('preloaded') }],
    });
    const back = await s.load('preloaded');
    expect(back?.name).toBe('preloaded');
    expect((await s.list()).map((e) => e.name)).toContain('preloaded');
  });
});
