import type { WorldObjectKind } from '@officexr/world';
import { studioApiUrl, studioFetch } from '../../../apiOrigin.ts';

export interface UploadFileSpec {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface UploadTarget {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Thrown by `finalize` while a bake or render holds the studio's heavy-work lock (HTTP 409). */
export class StudioBusyError extends Error {
  constructor() {
    super('studio busy');
  }
}

export interface ModelSourcesClient {
  requestUploadUrls(pack: string, files: UploadFileSpec[]): Promise<UploadTarget[]>;
  put(target: UploadTarget, file: Blob): Promise<void>;
  finalize(pack: string, entry: string): Promise<WorldObjectKind>;
}

async function postJson<T>(path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(studioApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    throw new StudioBusyError();
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `request failed (${res.status})`);
  }
  return json;
}

export function createModelSourcesClient(fetchImpl: typeof fetch = studioFetch): ModelSourcesClient {
  return {
    async requestUploadUrls(pack, files) {
      const { uploads } = await postJson<{ uploads: UploadTarget[] }>(
        '/api/model-sources/upload-url',
        { pack, files },
        fetchImpl,
      );
      return uploads;
    },
    async put(target, file) {
      // Signed URL goes straight to GCS: exactly the signed headers, no credentials.
      const res = await fetch(target.url, { method: target.method, headers: target.headers, body: file });
      if (!res.ok) {
        throw new Error(`upload failed (${res.status})`);
      }
    },
    async finalize(pack, entry) {
      const { kind } = await postJson<{ kind: WorldObjectKind }>(
        '/api/model-sources/finalize',
        { pack, entry },
        fetchImpl,
      );
      return kind;
    },
  };
}
