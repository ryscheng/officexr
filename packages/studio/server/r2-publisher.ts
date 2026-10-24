import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { Logger, NodeIO, type JSONDocument } from '@gltf-transform/core';
import { assetContentType } from '@officexr/world/asset-content-type';
import { compressDocument, registerCompressionCodecs } from '@officexr/world/glb-compression';

/** Bump to republish every unit, e.g. after changing compression settings. */
export const PUBLISHER_FORMAT_VERSION = '1';

const SOURCE_SHA_HEADER = 'x-amz-meta-source-sha256';
const CACHE_CONTROL = 'public, max-age=300';
const UNCOMPRESSED_MODEL_DIRS = ['models/characters/', 'models/animations/'];

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

type File = { key: string; path: string };
/** A file a `.gltf` references, by the URI as written in the `.gltf`. */
type Resource = File & { uri: string };
type GltfUnit = { type: 'gltf'; resources: Resource[] } & File;

/** A set of files published together; `key` is the file uploaded last, carrying the source hash. */
type Unit = GltfUnit | ({ type: 'file' } & File) | { type: 'invalid'; key: string; error: unknown };

type Upload = { key: string; bytes: Uint8Array };

interface SyncDirs {
  modelsDir: string;
  bakedLayoutsDir: string;
}

export type R2Publisher = ReturnType<typeof createR2Publisher>;

/** Reads the four `OFFICEXR_R2_*` vars; `null` (publishing off) unless all are set. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv): R2Config | null {
  const endpoint = env.OFFICEXR_R2_ENDPOINT;
  const bucket = env.OFFICEXR_R2_BUCKET;
  const accessKeyId = env.OFFICEXR_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.OFFICEXR_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { endpoint: endpoint.replace(/\/$/, ''), bucket, accessKeyId, secretAccessKey };
}

export function createR2Publisher(config: R2Config, fetchFn: typeof fetch = fetch) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  let ioReady: Promise<NodeIO> | undefined;
  const compressionIo = () =>
    (ioReady ??= registerCompressionCodecs(new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN))));

  // Every operation runs one at a time, so a sync unit that read a layout
  // earlier can never land after a newer rebake's upload of it.
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  }

  async function send(method: 'HEAD' | 'PUT' | 'DELETE', key: string, init: RequestInit = {}) {
    const request = await client.sign(`${config.endpoint}/${config.bucket}/${encodeKey(key)}`, {
      method,
      ...init,
    });
    const res = await fetchFn(request);
    if (!res.ok && !(method === 'HEAD' && res.status === 404)) {
      throw new Error(`${method} ${key}: ${res.status} ${await res.text()}`);
    }
    // Release the connection; only the headers are used.
    await res.body?.cancel();
    return res;
  }

  function put({ key, bytes }: Upload, sourceSha?: string) {
    return send('PUT', key, {
      body: bytes as Uint8Array<ArrayBuffer>,
      headers: {
        'content-type': assetContentType(key),
        'cache-control': CACHE_CONTROL,
        ...(sourceSha ? { [SOURCE_SHA_HEADER]: sourceSha } : {}),
      },
    });
  }

  async function isPublished(key: string, sourceSha: string) {
    return (await send('HEAD', key)).headers.get(SOURCE_SHA_HEADER) === sourceSha;
  }

  /** Uploads `key` (compressing it if eligible) unless it is already published from these bytes. */
  async function publishBytes(key: string, bytes: Uint8Array): Promise<boolean> {
    const sourceSha = sourceHash([bytes]);
    if (await isPublished(key, sourceSha)) {
      return false;
    }
    const out =
      key.endsWith('.glb') && isCompressible(key) && !declaresMeshopt(glbJson(bytes))
        ? await compressGlb(bytes)
        : bytes;
    await put({ key, bytes: out }, sourceSha);
    return true;
  }

  async function compressGlb(bytes: Uint8Array) {
    const io = await compressionIo();
    const doc = await io.readBinary(bytes);
    await doc.transform(compressDocument);
    return io.writeBinary(doc);
  }

  async function publishGltf(unit: GltfUnit, uploaded: Set<string>): Promise<boolean> {
    const gltfBytes = await readFile(unit.path);
    const resourceBytes = await Promise.all(unit.resources.map((r) => readFile(r.path)));
    const sourceSha = sourceHash([gltfBytes, ...resourceBytes]);
    if (await isPublished(unit.key, sourceSha)) {
      return false;
    }
    const json = JSON.parse(gltfBytes.toString('utf8'));
    const { gltf, resources } =
      isCompressible(unit.key) && !declaresMeshopt(json)
        ? await compressGltf(unit, {
            json,
            resources: Object.fromEntries(unit.resources.map((r, i) => [r.uri, resourceBytes[i]])),
          })
        : { gltf: gltfBytes, resources: unit.resources.map((r, i) => ({ key: r.key, bytes: resourceBytes[i] })) };
    // Resources first, so a client never pairs the new .gltf with old buffers.
    for (const resource of resources) {
      if (!uploaded.has(resource.key)) {
        await put(resource);
        uploaded.add(resource.key);
      }
    }
    await put({ key: unit.key, bytes: gltf }, sourceSha);
    return true;
  }

  async function compressGltf(unit: GltfUnit, source: JSONDocument) {
    const io = await compressionIo();
    const doc = await io.readJSON(source);
    await doc.transform(compressDocument);
    const sourceUris = new Set(unit.resources.map((r) => r.uri));
    const stem = path.posix.basename(unit.key, '.gltf');
    // ponytail: assumes no .bin or uri-less image is shared between .gltfs in one directory.
    doc.getRoot().listBuffers().forEach((buffer, i) => {
      if (!sourceUris.has(buffer.getURI())) {
        buffer.setURI(`${stem}_${i}.bin`);
      }
    });
    const { json, resources } = await io.writeJSON(doc);
    const dir = path.posix.dirname(unit.key);
    return {
      gltf: new TextEncoder().encode(JSON.stringify(json)),
      resources: Object.entries(resources).map(([uri, bytes]) => ({
        key: path.posix.join(dir, decodeURIComponent(uri)),
        bytes,
      })),
    };
  }

  async function publishUnit(unit: Unit, uploaded: Set<string>): Promise<boolean> {
    switch (unit.type) {
      case 'gltf':
        return publishGltf(unit, uploaded);
      case 'file':
        return publishBytes(unit.key, await readFile(unit.path));
      case 'invalid':
        throw unit.error;
    }
    const _exhaustive: never = unit;
    return _exhaustive;
  }

  /** Publishes every model and baked layout that changed since its last upload; never rejects. */
  async function sync(dirs: SyncDirs): Promise<void> {
    let units: Unit[];
    try {
      units = [
        ...(await modelUnits(dirs.modelsDir)),
        ...(await bakedLayoutUnits(dirs.bakedLayoutsDir)),
      ];
    } catch (err) {
      console.error('[r2-publisher] sync failed to list assets:', err);
      return;
    }
    const uploaded = new Set<string>();
    const counts = { uploaded: 0, unchanged: 0, failed: 0 };
    for (const unit of units) {
      try {
        const changed = await enqueue(() => publishUnit(unit, uploaded));
        counts[changed ? 'uploaded' : 'unchanged']++;
      } catch (err) {
        counts.failed++;
        console.error(`[r2-publisher] ${unit.key} failed:`, err);
      }
    }
    console.log(
      `[r2-publisher] sync done: ${counts.uploaded} uploaded, ${counts.unchanged} unchanged, ${counts.failed} failed`,
    );
  }

  return {
    sync,
    /** Storage hooks for `/api/baked-layouts`: mirror each rebake and delete to the bucket. */
    bakedLayoutHooks: {
      onSaved: (name: string, bytes: Uint8Array) =>
        enqueue(() => publishBytes(bakedLayoutKey(name), bytes)).then(() => {}),
      onDeleted: (name: string) => enqueue(() => send('DELETE', bakedLayoutKey(name))).then(() => {}),
    },
  };
}

const bakedLayoutKey = (name: string) => `baked-layouts/${name}.glb`;

function isCompressible(key: string) {
  return !UNCOMPRESSED_MODEL_DIRS.some((dir) => key.startsWith(dir));
}

function sourceHash(files: Uint8Array[]) {
  const hash = createHash('sha256').update(PUBLISHER_FORMAT_VERSION);
  for (const bytes of files) {
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function declaresMeshopt(json: { extensionsUsed?: string[] }) {
  return json.extensionsUsed?.includes('EXT_meshopt_compression') ?? false;
}

/** The JSON chunk of a GLB, which always comes first. */
function glbJson(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** One unit per `.gltf` (with the files it references) and per file no `.gltf` references. */
async function modelUnits(modelsDir: string): Promise<Unit[]> {
  const files = (await readdir(modelsDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(modelsDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
  const toFile = (rel: string): File => ({ key: `models/${rel}`, path: path.join(modelsDir, rel) });
  const units: Unit[] = [];
  const referenced = new Set<string>();
  for (const rel of files.filter((f) => f.endsWith('.gltf'))) {
    try {
      const resources = gltfResources(rel, JSON.parse(await readFile(path.join(modelsDir, rel), 'utf8')));
      resources.forEach((r) => referenced.add(r.rel));
      units.push({ type: 'gltf', ...toFile(rel), resources: resources.map((r) => ({ uri: r.uri, ...toFile(r.rel) })) });
    } catch (error) {
      units.push({ type: 'invalid', key: `models/${rel}`, error });
    }
  }
  for (const rel of files) {
    if (!rel.endsWith('.gltf') && !referenced.has(rel)) {
      units.push({ type: 'file', ...toFile(rel) });
    }
  }
  return units;
}

/** The distinct external files a `.gltf` at `rel` references, as written and resolved under the models dir. */
function gltfResources(rel: string, json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] }) {
  const uris = new Set(
    [...(json.buffers ?? []), ...(json.images ?? [])]
      .map((r) => r.uri)
      .filter((uri): uri is string => !!uri && !uri.startsWith('data:')),
  );
  return [...uris].map((uri) => {
    const resolved = path.posix.join(path.posix.dirname(rel), decodeURIComponent(uri));
    if (resolved.startsWith('../')) {
      throw new Error(`resource ${uri} escapes the models dir`);
    }
    return { uri, rel: resolved };
  });
}

async function bakedLayoutUnits(dir: string): Promise<Unit[]> {
  const names = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  });
  return names
    .filter((name) => name.endsWith('.glb'))
    .map((name) => ({ type: 'file', key: bakedLayoutKey(path.basename(name, '.glb')), path: path.join(dir, name) }));
}
