import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import type { HeavyWorkLock } from '@officexr/studio-mcp/mount-mcp';
import {
  type ModelSourcePack,
  type ModelSources,
  ModelSourceServiceError,
  type UploadFile,
} from '@officexr/studio-mcp/model-sources';
import { resolveOptimizer } from '@officexr/world/bake-optimizers';
import { compressDocument, registerCompressionCodecs } from '@officexr/world/glb-compression';
import { readSourceGltf, type ModelSourceReader } from '@officexr/world/model-source';
import {
  type CatalogStorage,
  isValidSceneName,
  kindLabelFromFileName,
  newWorldObjectKind,
  normalizeKind,
  validateWorldObjectKindCatalog,
  type WorldObjectKind,
  type WorldObjectKindCatalogV1,
} from '@officexr/world/scenes';
import { bundledModelPacks } from '../studio-backend.ts';
import { type ModelSourceStore, SHA256_PATTERN, UPLOAD_EXTENSION } from './store.ts';

const MAX_FILES_PER_REQUEST = 50;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const ENTRY_EXTENSION = /\.(glb|gltf)$/;

export interface ModelSourcesServiceDeps {
  store: ModelSourceStore;
  /** A getter because the loopback origin is only known once the internal server listens. */
  catalog: () => CatalogStorage;
  /** The lock bakes and renders take; finalize takes it too. */
  heavyWorkLock: HeavyWorkLock;
  uploadedModelsDir: string;
  /** Mirrors `<uploadedModelsDir>/<rel>` to the CDN. */
  publishModel: (rel: string) => Promise<void>;
  bundledPacks?: () => Promise<Set<string>>;
}

const invalid = (message: string) => new ModelSourceServiceError({ type: 'validation', message });

function checkPackName(pack: string): void {
  if (!isValidSceneName(pack)) {
    throw invalid(`invalid pack "${pack}": use letters, digits, ".", "_" or "-", at most 64 characters`);
  }
}

function checkPath(p: string, extension: RegExp): void {
  if (!PATH_PATTERN.test(p) || p.split('/').some((seg) => seg === '.' || seg === '..')) {
    throw invalid(`invalid path "${p}": use "/"-separated segments of letters, digits, ".", "_" or "-", no "." or ".."`);
  }
  if (!extension.test(p)) {
    throw invalid(`invalid path "${p}": unsupported extension`);
  }
}

function checkUploadFile({ path: p, sha256, sizeBytes }: UploadFile): void {
  checkPath(p, UPLOAD_EXTENSION);
  if (!SHA256_PATTERN.test(sha256)) {
    throw invalid(`"${p}": sha256 must be 64 lowercase hex characters`);
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_FILE_BYTES) {
    throw invalid(`"${p}": sizeBytes must be an integer from 1 to ${MAX_FILE_BYTES}`);
  }
}

const sourceKey = (pack: string, p: string) => `packs/${pack}/${p}`;
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Reads through `store`, failing any object that is missing or whose bytes don't match its upload's sha256. */
function verifiedReader(store: ModelSourceStore): ModelSourceReader {
  return {
    read: async (key) => {
      const [stat, bytes] = await Promise.all([store.stat(key), store.read(key)]);
      if (!stat || !bytes) {
        throw invalid(`"${key}" has not been uploaded`);
      }
      if (stat.sha256Meta !== sha256Hex(bytes)) {
        throw invalid(`"${key}" does not match its declared sha256; upload it again`);
      }
      return bytes;
    },
  };
}

const emptyCatalog = (): WorldObjectKindCatalogV1 => ({ schemaVersion: 1, updatedAt: 0, kinds: [] });

/** `catalog` with the kind for `sourceObject` added or repointed; rejects an id another source already owns. */
function withKind(
  catalog: WorldObjectKindCatalogV1,
  { id, label, gltfPath, sourceObject }: { id: string; label: string; gltfPath: string; sourceObject: string },
): { catalog: WorldObjectKindCatalogV1; kind: WorldObjectKind } {
  const existing = catalog.kinds.find((k) => k.id === id);
  if (existing && existing.sourceObject !== sourceObject) {
    throw invalid(`kind "${id}" already belongs to ${existing.sourceObject ? `"${existing.sourceObject}"` : 'a model without a private source'}`);
  }
  let kind: WorldObjectKind;
  try {
    kind = normalizeKind(
      { ...(existing ?? newWorldObjectKind({ id, label, gltfPath, swatch: '#64748b', category: 'furniture' })), gltfPath, sourceObject },
      0,
    );
  } catch (err) {
    throw invalid(`kind "${id}" would be invalid: ${(err as Error).message}`);
  }
  const kinds = existing ? catalog.kinds.map((k) => (k.id === id ? kind : k)) : [...catalog.kinds, kind];
  return { catalog: { ...catalog, updatedAt: Date.now(), kinds }, kind };
}

export class ModelSourcesService implements ModelSources {
  private readonly bundledPacks: () => Promise<Set<string>>;

  constructor(private readonly deps: ModelSourcesServiceDeps) {
    this.bundledPacks = deps.bundledPacks ?? (() => bundledModelPacks());
  }

  private async checkPack(pack: string): Promise<void> {
    checkPackName(pack);
    if ((await this.bundledPacks()).has(pack)) {
      throw invalid(`pack "${pack}" is a bundled model pack; choose another name`);
    }
  }

  async requestUpload(pack: string, files: UploadFile[]) {
    await this.checkPack(pack);
    if (files.length < 1 || files.length > MAX_FILES_PER_REQUEST) {
      throw invalid(`request 1 to ${MAX_FILES_PER_REQUEST} files per call, not ${files.length}`);
    }
    files.forEach(checkUploadFile);
    const uploads = await Promise.all(
      files.map(async ({ path: p, sha256, sizeBytes }) => {
        const signed = await this.deps.store.signUpload(sourceKey(pack, p), { sha256, sizeBytes });
        return { path: p, ...signed, expiresAt: signed.expiresAt.toISOString() };
      }),
    );
    return { uploads };
  }

  async finalize(pack: string, entry: string) {
    await this.checkPack(pack);
    checkPath(entry, ENTRY_EXTENSION);
    const stem = entry.replace(ENTRY_EXTENSION, '');
    const rel = `${pack}/${stem}.glb`;
    const kindFields = { id: `${pack}/${stem}`, label: kindLabelFromFileName(path.posix.basename(entry)), sourceObject: sourceKey(pack, entry) };
    let release: () => void;
    try {
      release = this.deps.heavyWorkLock.acquire();
    } catch (err) {
      throw new ModelSourceServiceError({ type: 'busy', message: (err as Error).message });
    }
    try {
      withKind((await this.deps.catalog().load()) ?? emptyCatalog(), { ...kindFields, gltfPath: `/models/${rel}` });
      const glb = await this.buildDerivative(kindFields.sourceObject);
      const file = path.join(this.deps.uploadedModelsDir, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, glb);
      await this.deps.publishModel(rel);
      // The content hash changes `gltfPath` on every new derivative, so bakes of layouts using the kind turn stale
      // (their fingerprint covers the catalog entry, not the source bytes) and cached copies of the old GLB are bypassed.
      const gltfPath = `/models/${rel}?v=${sha256Hex(glb).slice(0, 12)}`;
      // ponytail: the Object editor PUTs its whole catalog on any edit; a tab opened before this save drops or reverts the kind.
      const catalog = this.deps.catalog();
      const updated = withKind((await catalog.load()) ?? emptyCatalog(), { ...kindFields, gltfPath });
      await catalog.save(validateWorldObjectKindCatalog(updated.catalog));
      return { kind: updated.kind };
    } finally {
      release();
    }
  }

  private async buildDerivative(entryKey: string): Promise<Uint8Array> {
    let doc;
    try {
      doc = await readSourceGltf(verifiedReader(this.deps.store), entryKey);
    } catch (err) {
      // readSourceGltf's own errors can quote source content (a JSON.parse snippet, a resource URI); never echo it.
      if (err instanceof ModelSourceServiceError) {
        throw err;
      }
      throw invalid(`"${entryKey}" is not a valid glTF or GLB, or references a file outside its pack`);
    }
    await resolveOptimizer('simplify-aggressive').apply(doc);
    await doc.transform(compressDocument);
    return (await registerCompressionCodecs(new NodeIO())).writeBinary(doc);
  }

  async list(pack?: string) {
    if (pack !== undefined) {
      checkPackName(pack);
    }
    const [entries, catalog] = await Promise.all([
      this.deps.store.list(pack === undefined ? 'packs/' : `packs/${pack}/`),
      this.deps.catalog().load(),
    ]);
    const finalized = new Set(catalog?.kinds.flatMap((k) => (k.sourceObject ? [k.sourceObject] : [])));
    const packs = new Map<string, ModelSourcePack>();
    for (const { key, sizeBytes, updated } of entries) {
      const [, name, ...rest] = key.split('/');
      const p = rest.join('/');
      const group = packs.get(name) ?? { pack: name, files: [], finalizedEntries: [] };
      packs.set(name, group);
      group.files.push({ path: p, sizeBytes, updated: updated.toISOString() });
      if (finalized.has(key)) {
        group.finalizedEntries.push(p);
      }
    }
    return { packs: [...packs.values()] };
  }
}
