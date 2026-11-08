// @vitest-environment node
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { HeavyWorkLock } from '@officexr/studio-mcp/mount-mcp';
import { ModelSourceServiceError, type UploadFile } from '@officexr/studio-mcp/model-sources';
import { registerCompressionCodecs } from '@officexr/world/glb-compression';
import type { CatalogStorage, WorldObjectKindCatalogV1 } from '@officexr/world/scenes';
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelSourcesService } from './service.ts';
import { gridDoc, gridGlb, InMemoryModelSourceStore, sha } from './test-fixtures.ts';

class MemoryCatalog implements CatalogStorage {
  constructor(public doc: WorldObjectKindCatalogV1 | null = null) {}
  async load() {
    return this.doc;
  }
  async save(doc: WorldObjectKindCatalogV1) {
    this.doc = doc;
  }
}

async function triangleCount(glb: Uint8Array): Promise<number> {
  const doc = await (await registerCompressionCodecs(new NodeIO())).readBinary(glb);
  return doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
}

const file = (p: string): UploadFile => ({ path: p, sha256: 'a'.repeat(64), sizeBytes: 10 });

let store: InMemoryModelSourceStore;
let catalog: MemoryCatalog;
let dir: string;
let published: string[];
let lock: HeavyWorkLock;
let service: ModelSourcesService;

async function rejection(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ModelSourceServiceError);
  return (err as ModelSourceServiceError).error;
}

beforeEach(async () => {
  store = new InMemoryModelSourceStore();
  catalog = new MemoryCatalog();
  dir = await mkdtemp(path.join(tmpdir(), 'model-sources-'));
  published = [];
  lock = new HeavyWorkLock('a bake or render');
  service = new ModelSourcesService({
    store,
    catalog: () => catalog,
    heavyWorkLock: lock,
    uploadedModelsDir: dir,
    publishModel: async (rel) => {
      published.push(rel);
    },
    bundledPacks: async () => new Set(['furniture']),
  });
});

describe('requestUpload', () => {
  it('signs one upload per file under packs/<pack>/', async () => {
    const { uploads } = await service.requestUpload('kit', [file('a.gltf'), file('tex/a.png')]);
    expect(uploads.map((u) => [u.path, u.url, u.method, u.expiresAt])).toEqual([
      ['a.gltf', 'https://signed.test/packs/kit/a.gltf', 'PUT', '1970-01-01T00:00:00.000Z'],
      ['tex/a.png', 'https://signed.test/packs/kit/tex/a.png', 'PUT', '1970-01-01T00:00:00.000Z'],
    ]);
  });

  it.each([
    ['a traversal', 'kit', [file('../a.glb')], 'invalid path'],
    ['a "." segment', 'kit', [file('./a.glb')], 'invalid path'],
    ['an empty segment', 'kit', [file('a//b.glb')], 'invalid path'],
    ['a bad extension', 'kit', [file('a.txt')], 'unsupported extension'],
    ['an uppercase extension', 'kit', [file('a.GLB')], 'unsupported extension'],
    ['too many files', 'kit', Array.from({ length: 51 }, (_, i) => file(`m${i}.glb`)), '1 to 50'],
    ['no files', 'kit', [], '1 to 50'],
    ['a bundled pack', 'furniture', [file('a.glb')], 'bundled model pack'],
    ['an invalid pack', '..', [file('a.glb')], 'invalid pack'],
    ['a bad sha256', 'kit', [{ ...file('a.glb'), sha256: 'A'.repeat(64) }], 'sha256'],
    ['an oversized file', 'kit', [{ ...file('a.glb'), sizeBytes: 100 * 1024 * 1024 + 1 }], 'sizeBytes'],
    ['an empty file', 'kit', [{ ...file('a.glb'), sizeBytes: 0 }], 'sizeBytes'],
  ])('rejects %s', async (_, pack, files, message) => {
    const error = await rejection(service.requestUpload(pack, files));
    expect(error.type).toBe('validation');
    expect(error.message).toContain(message);
  });
});

describe('finalize', () => {
  it('builds a simplified GLB from a .glb, publishes it and adds a kind pointing at it and the raw source', async () => {
    const raw = await gridGlb();
    store.put('packs/kit/models/chair.glb', raw);

    const { kind } = await service.finalize('kit', 'models/chair.glb');

    const derivative = await readFile(path.join(dir, 'kit/models/chair.glb'));
    expect(await triangleCount(derivative)).toBeLessThan(await triangleCount(raw));
    expect(published).toEqual(['kit/models/chair.glb']);
    expect(kind).toMatchObject({
      id: 'kit/models/chair',
      label: 'Chair',
      gltfPath: `/models/kit/models/chair.glb?v=${sha(derivative).slice(0, 12)}`,
      sourceObject: 'packs/kit/models/chair.glb',
    });
    expect(catalog.doc?.kinds).toEqual([kind]);
  });

  it('builds from a .gltf with its buffer', async () => {
    const { json, resources } = await new NodeIO().writeJSON(gridDoc());
    json.buffers![0].uri = 'chair.bin';
    store.put('packs/kit/chair.gltf', new TextEncoder().encode(JSON.stringify(json)));
    store.put('packs/kit/chair.bin', Object.values(resources)[0]);

    const { kind } = await service.finalize('kit', 'chair.gltf');

    expect(kind.sourceObject).toBe('packs/kit/chair.gltf');
    expect(await triangleCount(await readFile(path.join(dir, 'kit/chair.glb')))).toBeLessThan(24 * 24 * 2);
  });

  it('fails a .gltf whose .bin was never uploaded', async () => {
    const { json } = await new NodeIO().writeJSON(gridDoc());
    json.buffers![0].uri = 'chair.bin';
    store.put('packs/kit/chair.gltf', new TextEncoder().encode(JSON.stringify(json)));

    const error = await rejection(service.finalize('kit', 'chair.gltf'));
    expect(error).toEqual({ type: 'validation', message: '"packs/kit/chair.bin" has not been uploaded' });
    expect(catalog.doc).toBeNull();
  });

  it('fails an object whose bytes do not match its sha256', async () => {
    store.put('packs/kit/chair.glb', await gridGlb(), 'b'.repeat(64));
    const error = await rejection(service.finalize('kit', 'chair.glb'));
    expect(error.type).toBe('validation');
    expect(error.message).toContain('sha256');
  });

  it('rejects a non-model entry and a bundled pack', async () => {
    expect((await rejection(service.finalize('kit', 'chair.bin'))).type).toBe('validation');
    expect((await rejection(service.finalize('furniture', 'chair.glb'))).message).toContain('bundled');
  });

  it('is busy while a bake or render holds the lock', async () => {
    store.put('packs/kit/chair.glb', await gridGlb());
    const release = lock.acquire();
    expect((await rejection(service.finalize('kit', 'chair.glb'))).type).toBe('busy');
    release();
    await service.finalize('kit', 'chair.glb');
  });

  it('keeps tuned fields on re-finalize and changes gltfPath when the model changes', async () => {
    store.put('packs/kit/chair.glb', await gridGlb());
    const first = (await service.finalize('kit', 'chair.glb')).kind;
    catalog.doc = { ...catalog.doc!, kinds: [{ ...first, scale: 2, label: 'Tuned' }] };

    store.put('packs/kit/chair.glb', await new NodeIO().writeBinary(gridDoc(8)));
    const second = (await service.finalize('kit', 'chair.glb')).kind;

    expect(second).toMatchObject({ scale: 2, label: 'Tuned', sourceObject: 'packs/kit/chair.glb' });
    expect(second.gltfPath).not.toBe(first.gltfPath);
    expect(catalog.doc?.kinds).toHaveLength(1);
  });
});

describe('list', () => {
  it('groups files by pack and marks finalized entries', async () => {
    store.put('packs/kit/chair.glb', await gridGlb());
    store.put('packs/kit/tex/a.png', new Uint8Array([1]));
    store.put('packs/other/b.glb', new Uint8Array([2]));
    await service.finalize('kit', 'chair.glb');

    const { packs } = await service.list();
    expect(packs.map((p) => [p.pack, p.files.map((f) => f.path), p.finalizedEntries])).toEqual([
      ['kit', ['chair.glb', 'tex/a.png'], ['chair.glb']],
      ['other', ['b.glb'], []],
    ]);
    expect((await service.list('other')).packs.map((p) => p.pack)).toEqual(['other']);
    expect((await rejection(service.list('..'))).type).toBe('validation');
  });
});
