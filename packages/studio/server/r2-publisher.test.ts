// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwsV4Signer } from 'aws4fetch';
import { Document, NodeIO } from '@gltf-transform/core';
import { registerCompressionCodecs } from '@officexr/world/glb-compression';
import studioStorage from '@officexr/world/vite-plugin-storage';
import {
  PUBLISHER_FORMAT_VERSION,
  createR2Publisher,
  r2ConfigFromEnv,
  type R2Config,
} from './r2-publisher.ts';

const BUCKET = 'assets';
const ACCESS_KEY_ID = 'id';
const SECRET = 'secret';
const META = 'x-amz-meta-source-sha256';

type StoredObject = { body: Buffer; headers: Record<string, string> };
type Held = { reached: Promise<void>; release: () => void };

/** Whether `req` carries a valid SigV4 signature for SECRET, recomputed over the headers it says it signed. */
async function signatureValid(req: IncomingMessage, origin: string) {
  const auth = req.headers.authorization ?? '';
  const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(';') ?? [];
  const headers = Object.fromEntries(
    signed.filter((name) => name !== 'host').map((name) => [name, String(req.headers[name])]),
  );
  const expected = await new AwsV4Signer({
    method: req.method,
    url: `${origin}${req.url}`,
    headers,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET,
    service: 's3',
    region: 'auto',
    datetime: String(req.headers['x-amz-date']),
  }).authHeader();
  return auth === expected;
}

/** Path-style S3 endpoint keeping objects in memory and logging every request. */
async function startFakeS3() {
  const objects = new Map<string, StoredObject>();
  const log: Array<{ method: string; key: string }> = [];
  const failing = new Set<string>();
  const holds = new Map<string, { arrive: () => void; released: Promise<void> }>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const [bucket, ...rest] = new URL(req.url!, 'http://x').pathname.slice(1).split('/');
    const key = rest.map(decodeURIComponent).join('/');
    if (bucket !== BUCKET || !(await signatureValid(req, origin))) {
      res.writeHead(403).end();
      return;
    }
    const hold = req.method === 'PUT' ? holds.get(key) : undefined;
    if (hold) {
      holds.delete(key);
      hold.arrive();
      await hold.released;
    }
    log.push({ method: req.method!, key });
    if (req.method === 'PUT') {
      if (failing.has(key)) {
        res.writeHead(500).end('boom');
        return;
      }
      const headers: Record<string, string> = {};
      for (const name of ['content-type', 'cache-control', META]) {
        if (req.headers[name]) {
          headers[name] = String(req.headers[name]);
        }
      }
      objects.set(key, { body: Buffer.concat(chunks), headers });
      res.writeHead(200).end();
    } else if (req.method === 'HEAD') {
      const obj = objects.get(key);
      res.writeHead(obj ? 200 : 404, obj?.headers).end();
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    objects,
    log,
    failing,
    endpoint: origin,
    puts: () => log.filter((r) => r.method === 'PUT').map((r) => r.key),
    /** Holds the next PUT of `key` until `release()`; `reached` resolves once it arrives. */
    hold(key: string): Held {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((r) => (arrive = r));
      holds.set(key, { arrive, released: new Promise<void>((r) => (release = r)) });
      return { reached, release };
    },
  };
}

const sha = (...parts: Uint8Array[]) => {
  const hash = createHash('sha256').update(PUBLISHER_FORMAT_VERSION);
  parts.forEach((p) => hash.update(p));
  return hash.digest('hex');
};

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function triangleDoc(offset: number, opts: { bin?: string; texture?: string } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer().setURI(opts.bin ?? '');
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([offset, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const material = doc.createMaterial();
  if (opts.texture) {
    material.setBaseColorTexture(
      doc.createTexture().setImage(PNG).setMimeType('image/png').setURI(opts.texture),
    );
  }
  const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return doc;
}

const glb = (offset: number) => new NodeIO().writeBinary(triangleDoc(offset));

describe('r2 publisher', () => {
  let root: string;
  let modelsDir: string;
  let bakedLayoutsDir: string;
  let s3: Awaited<ReturnType<typeof startFakeS3>>;
  let config: R2Config;
  const servers: Server[] = [];

  const dirs = () => ({ modelsDir, bakedLayoutsDir });
  const writeKind = (name: string, offset: number) =>
    new NodeIO().write(
      path.join(modelsDir, 'blocks', `${name}.gltf`),
      triangleDoc(offset, { bin: `${name}.bin`, texture: 'shared.png' }),
    );

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    root = await mkdtemp(path.join(tmpdir(), 'r2-publisher-'));
    modelsDir = path.join(root, 'models');
    bakedLayoutsDir = path.join(root, 'baked-layouts');
    for (const dir of ['blocks', 'characters', 'animations']) {
      await mkdir(path.join(modelsDir, dir), { recursive: true });
    }
    await mkdir(bakedLayoutsDir);
    await writeKind('a', 0);
    await writeKind('b', 1);
    await writeFile(path.join(modelsDir, 'blocks', 'License.txt'), 'CC0');
    await writeFile(path.join(modelsDir, 'characters', 'Knight.glb'), await glb(2));
    await writeFile(path.join(modelsDir, 'animations', 'Rig.glb'), await glb(3));
    await writeFile(path.join(bakedLayoutsDir, 'office.glb'), await glb(4));
    s3 = await startFakeS3();
    servers.push(s3.server);
    config = { endpoint: s3.endpoint, bucket: BUCKET, accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
    await rm(root, { recursive: true, force: true });
  });

  it('is off unless all four env vars are set', () => {
    const env = {
      OFFICEXR_R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
      OFFICEXR_R2_BUCKET: 'b',
      OFFICEXR_R2_ACCESS_KEY_ID: 'k',
      OFFICEXR_R2_SECRET_ACCESS_KEY: 's',
    };
    expect(r2ConfigFromEnv({})).toBeNull();
    for (const name of Object.keys(env)) {
      expect(r2ConfigFromEnv({ ...env, [name]: '' })).toBeNull();
    }
    expect(r2ConfigFromEnv(env)).toEqual({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });

  it('first sync uploads every file with keys, headers and source hash', async () => {
    await createR2Publisher(config).sync(dirs());
    const read = (rel: string) => readFile(path.join(root, rel));

    expect([...s3.objects.keys()].sort()).toEqual([
      'baked-layouts/office.glb',
      'models/animations/Rig.glb',
      'models/blocks/License.txt',
      'models/blocks/a.bin',
      'models/blocks/a.gltf',
      'models/blocks/b.bin',
      'models/blocks/b.gltf',
      'models/blocks/shared.png',
      'models/characters/Knight.glb',
    ]);
    const headers = (key: string) => s3.objects.get(key)!.headers;
    expect(headers('models/blocks/a.gltf')).toEqual({
      'content-type': 'model/gltf+json',
      'cache-control': 'public, max-age=300',
      [META]: sha(
        await read('models/blocks/a.gltf'),
        await read('models/blocks/a.bin'),
        await read('models/blocks/shared.png'),
      ),
    });
    expect(headers('models/blocks/a.bin')).toEqual({
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=300',
    });
    expect(headers('models/blocks/shared.png')['content-type']).toBe('image/png');
    expect(headers('models/blocks/License.txt')[META]).toBe(sha(await read('models/blocks/License.txt')));
    expect(headers('baked-layouts/office.glb')).toEqual({
      'content-type': 'model/gltf-binary',
      'cache-control': 'public, max-age=300',
      [META]: sha(await read('baked-layouts/office.glb')),
    });
  });

  it('a wrong secret uploads nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createR2Publisher({ ...config, secretAccessKey: 'wrong' }).sync(dirs());
    expect(s3.objects.size).toBe(0);
    expect(error).toHaveBeenCalled();
  });

  it('a broken .gltf fails alone while the other units publish', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(path.join(modelsDir, 'blocks', 'broken.gltf'), '{ not json');
    await writeFile(
      path.join(modelsDir, 'blocks', 'escapes.gltf'),
      JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../../outside.bin', byteLength: 1 }] }),
    );
    await createR2Publisher(config).sync(dirs());
    const failed = error.mock.calls.map(([message]) => message);
    expect(failed).toEqual([
      '[r2-publisher] models/blocks/broken.gltf failed:',
      '[r2-publisher] models/blocks/escapes.gltf failed:',
    ]);
    expect(s3.objects.has('models/blocks/a.gltf')).toBe(true);
    expect(s3.objects.has('baked-layouts/office.glb')).toBe(true);
    expect([...s3.objects.keys()].some((k) => k.includes('broken') || k.includes('outside'))).toBe(false);
  });

  it('keeps percent-encoded resource URIs resolving to their decoded keys', async () => {
    const dir = path.join(modelsDir, 'fbx(unity)');
    await mkdir(dir);
    const { json, resources } = await new NodeIO().writeJSON(triangleDoc(8, { bin: 'c%20d.bin' }));
    await writeFile(path.join(dir, 'c d.gltf'), JSON.stringify(json));
    await writeFile(path.join(dir, 'c d.bin'), resources['c%20d.bin']);
    await createR2Publisher(config).sync(dirs());
    const published = JSON.parse(s3.objects.get('models/fbx(unity)/c d.gltf')!.body.toString());
    expect(published.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(published.buffers[0].uri).toBe('c%20d.bin');
    expect(s3.objects.has('models/fbx(unity)/c d.bin')).toBe(true);
    expect([...s3.objects.keys()].filter((k) => k.includes('%'))).toEqual([]);
  });

  it('a second sync uploads nothing', async () => {
    const publisher = createR2Publisher(config);
    await publisher.sync(dirs());
    s3.log.length = 0;
    await publisher.sync(dirs());
    expect(s3.puts()).toEqual([]);
  });

  it('a changed file re-uploads only its unit', async () => {
    await createR2Publisher(config).sync(dirs());
    s3.log.length = 0;
    await writeFile(path.join(modelsDir, 'blocks', 'License.txt'), 'CC-BY');
    await createR2Publisher(config).sync(dirs());
    expect(s3.puts()).toEqual(['models/blocks/License.txt']);
  });

  it('a changed .bin alone republishes its .gltf unit', async () => {
    await createR2Publisher(config).sync(dirs());
    s3.log.length = 0;
    const { resources } = await new NodeIO().writeJSON(triangleDoc(9, { bin: 'a.bin', texture: 'shared.png' }));
    await writeFile(path.join(modelsDir, 'blocks', 'a.bin'), resources['a.bin']);
    await createR2Publisher(config).sync(dirs());
    expect(s3.puts()).toEqual(['models/blocks/shared.png', 'models/blocks/a.bin', 'models/blocks/a.gltf']);
  });

  it('a different format version republishes every unit', async () => {
    await createR2Publisher(config).sync(dirs());
    for (const obj of s3.objects.values()) {
      if (obj.headers[META]) {
        obj.headers[META] = createHash('sha256').update('previous-version').digest('hex');
      }
    }
    s3.log.length = 0;
    await createR2Publisher(config).sync(dirs());
    expect(s3.puts().sort()).toEqual([...s3.objects.keys()].sort());
  });

  it('compresses kinds, keeps relative resources, uploads buffers first and a shared texture once', async () => {
    await createR2Publisher(config).sync(dirs());

    const puts = s3.puts();
    expect(puts.filter((k) => k === 'models/blocks/shared.png')).toHaveLength(1);
    for (const name of ['a', 'b']) {
      expect(puts.indexOf(`models/blocks/${name}.bin`)).toBeLessThan(puts.indexOf(`models/blocks/${name}.gltf`));
    }
    expect(puts.indexOf('models/blocks/shared.png')).toBeLessThan(puts.indexOf('models/blocks/a.gltf'));

    const json = JSON.parse(s3.objects.get('models/blocks/a.gltf')!.body.toString());
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
    const uris = [...json.buffers, ...json.images].map((r: { uri?: string }) => r.uri).filter((uri): uri is string => !!uri);
    expect(uris.sort()).toEqual(['a.bin', 'shared.png']);

    const published = path.join(root, 'published');
    await mkdir(published);
    for (const name of ['a.gltf', ...uris]) {
      await writeFile(path.join(published, name), s3.objects.get(`models/blocks/${name}`)!.body);
    }
    const io = await registerCompressionCodecs(new NodeIO());
    const doc = await io.read(path.join(published, 'a.gltf'));
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
    expect(Buffer.from(doc.getRoot().listTextures()[0].getImage()!)).toEqual(PNG);
  });

  it('uploads characters and animations byte-for-byte and compresses an uncompressed layout', async () => {
    await createR2Publisher(config).sync(dirs());
    for (const rel of ['characters/Knight.glb', 'animations/Rig.glb']) {
      expect(s3.objects.get(`models/${rel}`)!.body).toEqual(await readFile(path.join(modelsDir, rel)));
    }
    const layout = s3.objects.get('baked-layouts/office.glb')!.body;
    const io = await registerCompressionCodecs(new NodeIO());
    const doc = await io.readBinary(layout);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('EXT_meshopt_compression');
  });

  it('uploads an already-compressed layout as-is', async () => {
    await createR2Publisher(config).sync(dirs());
    const bytes = s3.objects.get('baked-layouts/office.glb')!.body;
    await writeFile(path.join(bakedLayoutsDir, 'office.glb'), bytes);
    await createR2Publisher(config).sync(dirs());
    expect(s3.objects.get('baked-layouts/office.glb')!.body).toEqual(bytes);
  });

  it('never lets an in-flight sync overwrite a newer rebake', async () => {
    const publisher = createR2Publisher(config);
    const held = s3.hold('baked-layouts/office.glb');
    const syncing = publisher.sync(dirs());
    await held.reached;

    const rebaked = await glb(7);
    await writeFile(path.join(bakedLayoutsDir, 'office.glb'), rebaked);
    const hook = publisher.bakedLayoutHooks.onSaved('office', rebaked);
    // Give an unserialized hook upload the chance to land before the stale one.
    await Promise.race([hook, new Promise((r) => setTimeout(r, 200))]);
    held.release();
    await Promise.all([syncing, hook]);

    expect(s3.objects.get('baked-layouts/office.glb')!.headers[META]).toBe(sha(rebaked));
    s3.log.length = 0;
    await publisher.sync(dirs());
    expect(s3.puts()).toEqual([]);
  });

  describe('through the baked-layouts storage hooks', () => {
    async function serveStorage() {
      const publisher = createR2Publisher(config);
      const mounts: Array<[string, (req: IncomingMessage, res: ServerResponse, next: () => void) => void]> = [];
      const plugin = studioStorage({ dataDir: root, bakedLayouts: publisher.bakedLayoutHooks });
      (plugin.configureServer as (s: unknown) => void)({
        middlewares: { use: (base: string, h: (typeof mounts)[number][1]) => mounts.push([base, h]) },
      });
      const server = createServer((req, res) => {
        const mount = mounts.find(([base]) => req.url!.startsWith(`${base}/`))!;
        req.url = req.url!.slice(mount[0].length);
        mount[1](req, res, () => {});
      });
      servers.push(server);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/baked-layouts/lobby.glb`;
    }

    it('a rebake PUT uploads the layout and a DELETE removes it', async () => {
      const url = await serveStorage();
      const bytes = await glb(5);
      expect((await fetch(url, { method: 'PUT', body: bytes })).status).toBe(204);
      await vi.waitFor(() => expect(s3.objects.get('baked-layouts/lobby.glb')?.headers[META]).toBe(sha(bytes)));

      expect((await fetch(url, { method: 'DELETE' })).status).toBe(204);
      await vi.waitFor(() => expect(s3.objects.has('baked-layouts/lobby.glb')).toBe(false));
    });

    it('a failing upload still answers the PUT with 204', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      s3.failing.add('baked-layouts/lobby.glb');
      const url = await serveStorage();
      expect((await fetch(url, { method: 'PUT', body: await glb(6) })).status).toBe(204);
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(await readFile(path.join(bakedLayoutsDir, 'lobby.glb'))).toBeTruthy();
    });
  });
});
