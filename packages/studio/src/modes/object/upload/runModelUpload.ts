import type { WorldObjectKind } from '@officexr/world';
import type { SignedUpload, UploadFile } from '@officexr/studio-mcp/model-sources';
import { isStudioBusy, type ModelSourcesClient } from './modelSourcesClient.ts';

const MAX_BATCH = 50;
const MAX_CONCURRENT_PUTS = 4;
const MAX_BUSY_ATTEMPTS = 8;
const ENTRY_EXT = /\.(glb|gltf)$/;
// Mirrors the server rules in studio-server model-sources (service.ts, store.ts).
const UPLOAD_EXT = /\.(glb|gltf|bin|png|jpe?g|webp)$/;
const PATH_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface PackFile {
  path: string;
  file: File;
}

export type FileState =
  | { type: 'pending' }
  | { type: 'hashing' }
  | { type: 'uploading' }
  | { type: 'uploaded' }
  | { type: 'finalizing'; busy: boolean }
  | { type: 'done'; kindId: string }
  | { type: 'failed'; error: string };

const isEntryPath = (path: string) => ENTRY_EXT.test(path);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Pack-relative POSIX paths of the files with an upload extension (any case), without the picked
 * folder's own name. A repeated path keeps the last file.
 */
export function toPackFiles(picked: Iterable<File>): PackFile[] {
  const byPath = new Map<string, PackFile>();
  for (const file of picked) {
    const rel = file.webkitRelativePath;
    const path = rel ? rel.split('/').slice(1).join('/') : file.name;
    if (path && UPLOAD_EXT.test(path.toLowerCase())) {
      byPath.set(path, { path, file });
    }
  }
  return [...byPath.values()];
}

/** Why the server would reject this file, or null. */
export function rejectionReason({ path, file }: PackFile): string | null {
  if (!PATH_PATTERN.test(path) || path.split('/').some((seg) => seg === '.' || seg === '..')) {
    return 'path may only use letters, digits, ".", "_" and "-" in "/"-separated segments';
  }
  if (!UPLOAD_EXT.test(path)) {
    return 'extension must be lowercase .glb, .gltf, .bin, .png, .jpg, .jpeg or .webp';
  }
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    return 'size must be 1 B to 100 MB';
  }
  return null;
}

export const sha256Hex = async (file: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

export interface RunModelUploadOptions {
  onState: (path: string, state: FileState) => void;
  /** Called after each successful finalize so the catalog never lags the server. */
  onFinalized: (kind: WorldObjectKind) => void;
  /** Injected so tests don't wait out the 409 backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/** Uploads `files` to `pack`, then finalizes every uploaded `.glb`/`.gltf` entry, one at a time. */
export async function runModelUpload(
  client: ModelSourcesClient,
  pack: string,
  files: PackFile[],
  { onState, onFinalized, sleep = defaultSleep }: RunModelUploadOptions,
): Promise<void> {
  const failed = (path: string, error: string) => onState(path, { type: 'failed', error });
  const uploaded = new Set<string>();
  const failedSupport: string[] = [];
  const fail = (path: string, error: string) => {
    failed(path, error);
    if (!isEntryPath(path)) {
      failedSupport.push(path);
    }
  };

  const valid: PackFile[] = [];
  for (const f of files) {
    const reason = rejectionReason(f);
    if (reason) {
      fail(f.path, `rejected: ${reason}`);
    } else {
      valid.push(f);
    }
  }

  const putWithRetry = async (target: SignedUpload, file: File) => {
    try {
      await client.put(target, file).catch(() => client.put(target, file));
      uploaded.add(target.path);
      onState(target.path, { type: 'uploaded' });
    } catch (err) {
      fail(target.path, errorMessage(err));
    }
  };

  for (let i = 0; i < valid.length; i += MAX_BATCH) {
    const batch = valid.slice(i, i + MAX_BATCH);
    const specs: UploadFile[] = [];
    for (const { path, file } of batch) {
      onState(path, { type: 'hashing' });
      try {
        specs.push({ path, sha256: await sha256Hex(file), sizeBytes: file.size });
      } catch (err) {
        fail(path, errorMessage(err));
      }
    }
    let targets: SignedUpload[] = [];
    if (specs.length) {
      try {
        targets = await client.requestUploadUrls(pack, specs);
      } catch (err) {
        specs.forEach((s) => fail(s.path, errorMessage(err)));
        continue;
      }
    }
    const targeted = new Set(targets.map((t) => t.path));
    specs.filter((s) => !targeted.has(s.path)).forEach((s) => fail(s.path, 'no upload URL returned'));
    targets.forEach((t) => onState(t.path, { type: 'uploading' }));
    const byPath = new Map(batch.map((p) => [p.path, p.file]));
    // ponytail: signed URLs last 15 min, so a slow batch can outlive them; re-running the upload requests fresh ones.
    const queue = [...targets];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        await putWithRetry(t, byPath.get(t.path)!);
      }
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT_PUTS }, worker));
  }

  const finalize = async (path: string) => {
    for (let attempt = 1; ; attempt++) {
      onState(path, { type: 'finalizing', busy: attempt > 1 });
      try {
        return await client.finalize(pack, path);
      } catch (err) {
        if (isStudioBusy(err)) {
          if (attempt >= MAX_BUSY_ATTEMPTS) {
            throw err;
          }
          onState(path, { type: 'finalizing', busy: true });
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
          continue;
        }
        // The server may have finalized before the response was lost; don't leave its kind out of the catalog.
        const recovered = await client.recoverKind(pack, path).catch(() => null);
        if (recovered) {
          return recovered;
        }
        throw err;
      }
    }
  };

  for (const { path } of files) {
    if (!uploaded.has(path) || !isEntryPath(path)) {
      continue;
    }
    // A .gltf references its .bin and textures; a broken one would finalize into a kind that can't load.
    if (path.endsWith('.gltf') && failedSupport.length) {
      failed(path, `skipped: ${failedSupport[0]} did not upload`);
      continue;
    }
    try {
      const kind = await finalize(path);
      onState(path, { type: 'done', kindId: kind.id });
      onFinalized(kind);
    } catch (err) {
      failed(path, errorMessage(err));
    }
  }
}
