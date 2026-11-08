import { useCallback, useRef, useState } from 'react';
import type { WorldObjectKind } from '@officexr/world';
import { StudioBusyError, type ModelSourcesClient, type UploadFileSpec, type UploadTarget } from './modelSourcesClient.ts';

export const MAX_BATCH = 50;
export const MAX_CONCURRENT_PUTS = 4;
const MAX_BUSY_ATTEMPTS = 8;
const ALLOWED_EXT = /\.(glb|gltf|bin|png|jpe?g|webp)$/;
const ENTRY_EXT = /\.(glb|gltf)$/;

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

export interface FileEntry extends PackFile {
  state: FileState;
}

export const isEntryPath = (path: string) => ENTRY_EXT.test(path);

/** Pack-relative POSIX paths of the allowed files; drops the picked folder's own name. */
export function toPackFiles(picked: Iterable<File>): PackFile[] {
  const out: PackFile[] = [];
  for (const file of picked) {
    const rel = file.webkitRelativePath;
    const path = rel ? rel.split('/').slice(1).join('/') : file.name;
    if (path && ALLOWED_EXT.test(path.toLowerCase()) && file.size > 0) {
      out.push({ path, file });
    }
  }
  return out;
}

const sha256Hex = async (file: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface UseModelUploadOptions {
  client: ModelSourcesClient;
  /** Called once with every kind finalized by a run. */
  onFinalized: (kinds: WorldObjectKind[]) => void;
  /** Injected so tests don't wait out the 409 backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export interface UseModelUploadResult {
  files: FileEntry[];
  running: boolean;
  busy: boolean;
  start: (pack: string, files: PackFile[]) => Promise<void>;
}

export function useModelUpload({
  client,
  onFinalized,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: UseModelUploadOptions): UseModelUploadResult {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const start = useCallback(
    async (pack: string, picked: PackFile[]) => {
      if (runningRef.current) {
        return;
      }
      runningRef.current = true;
      setRunning(true);
      setFiles(picked.map((p) => ({ ...p, state: { type: 'pending' } })));
      const setState = (paths: string[], state: FileState) =>
        setFiles((prev) => prev.map((f) => (paths.includes(f.path) ? { ...f, state } : f)));

      const uploaded = new Set<string>();
      const uploadOne = async (target: UploadTarget, file: File) => {
        try {
          await client.put(target, file).catch(() => client.put(target, file));
          uploaded.add(target.path);
          setState([target.path], { type: 'uploaded' });
        } catch (err) {
          setState([target.path], { type: 'failed', error: errorMessage(err) });
        }
      };

      try {
        for (let i = 0; i < picked.length; i += MAX_BATCH) {
          const batch = picked.slice(i, i + MAX_BATCH);
          const specs: UploadFileSpec[] = [];
          for (const { path, file } of batch) {
            setState([path], { type: 'hashing' });
            try {
              specs.push({ path, sha256: await sha256Hex(file), sizeBytes: file.size });
            } catch (err) {
              setState([path], { type: 'failed', error: errorMessage(err) });
            }
          }
          const byPath = new Map(batch.map((p) => [p.path, p.file]));
          let targets;
          try {
            targets = specs.length ? await client.requestUploadUrls(pack, specs) : [];
          } catch (err) {
            setState(specs.map((s) => s.path), { type: 'failed', error: errorMessage(err) });
            continue;
          }
          setState(targets.map((t) => t.path), { type: 'uploading' });
          // ponytail: signed URLs last 15 min, so a very large pack can outlive them; re-run to refresh.
          const queue = [...targets];
          const worker = async () => {
            for (let t = queue.shift(); t; t = queue.shift()) {
              await uploadOne(t, byPath.get(t.path)!);
            }
          };
          await Promise.all(Array.from({ length: MAX_CONCURRENT_PUTS }, worker));
        }

        const kinds: WorldObjectKind[] = [];
        for (const path of uploaded) {
          if (!isEntryPath(path)) {
            continue;
          }
          const kind = await finalizeWithBackoff(path);
          if (kind) {
            kinds.push(kind);
          }
        }
        if (kinds.length) {
          onFinalized(kinds);
        }
      } finally {
        runningRef.current = false;
        setRunning(false);
      }

      async function finalizeWithBackoff(path: string): Promise<WorldObjectKind | null> {
        for (let attempt = 1; ; attempt++) {
          setState([path], { type: 'finalizing', busy: attempt > 1 });
          try {
            const kind = await client.finalize(pack, path);
            setState([path], { type: 'done', kindId: kind.id });
            return kind;
          } catch (err) {
            if (err instanceof StudioBusyError && attempt < MAX_BUSY_ATTEMPTS) {
              setState([path], { type: 'finalizing', busy: true });
              await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
              continue;
            }
            setState([path], { type: 'failed', error: errorMessage(err) });
            return null;
          }
        }
      }
    },
    [client, onFinalized, sleep],
  );

  const busy = files.some((f) => f.state.type === 'finalizing' && f.state.busy);
  return { files, running, busy, start };
}
