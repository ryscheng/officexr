import type { WorldObjectKind } from '@officexr/world';
import type { ModelSourcePack, SignedUpload, UploadFile } from '@officexr/studio-mcp/model-sources';
import { paths, studioApiUrl, studioFetch } from '../../../apiOrigin.ts';

/** Thrown by `finalize` while a bake or render holds the studio's heavy-work lock (HTTP 409). */
export class StudioBusyError extends Error {
  constructor() {
    super('studio busy');
    this.name = 'StudioBusyError';
  }
}

/** By name, so an injected client's errors count without sharing this module's class. */
export const isStudioBusy = (err: unknown) => err instanceof Error && err.name === 'StudioBusyError';

export interface ModelSourcesClient {
  requestUploadUrls(pack: string, files: UploadFile[]): Promise<SignedUpload[]>;
  put(target: SignedUpload, file: Blob): Promise<void>;
  finalize(pack: string, entry: string): Promise<WorldObjectKind>;
  /** The entry's kind if the server finalized it after all (e.g. the response was lost), else null. */
  recoverKind(pack: string, entry: string): Promise<WorldObjectKind | null>;
}

export function createModelSourcesClient(fetchImpl: typeof fetch = studioFetch): ModelSourcesClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(studioApiUrl(path), init);
    if (res.status === 409) {
      throw new StudioBusyError();
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(json.error ?? `request failed (${res.status})`);
    }
    return json;
  }
  const post = <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    async requestUploadUrls(pack, files) {
      return (await post<{ uploads: SignedUpload[] }>('/api/model-sources/upload-url', { pack, files })).uploads;
    },
    async put(target, file) {
      // The signed URL goes straight to GCS: exactly the signed headers and no cookies.
      const res = await fetchImpl(target.url, {
        method: target.method,
        headers: target.headers,
        body: file,
        credentials: 'omit',
      });
      if (!res.ok) {
        throw new Error(`upload failed (${res.status})`);
      }
    },
    async finalize(pack, entry) {
      return (await post<{ kind: WorldObjectKind }>('/api/model-sources/finalize', { pack, entry })).kind;
    },
    async recoverKind(pack, entry) {
      const { packs } = await request<{ packs: ModelSourcePack[] }>(
        `/api/model-sources?pack=${encodeURIComponent(pack)}`,
      );
      if (!packs.some((p) => p.pack === pack && p.finalizedEntries.includes(entry))) {
        return null;
      }
      const { kinds } = await request<{ kinds: WorldObjectKind[] }>(paths.worldObjectKinds);
      return kinds.find((k) => k.sourceObject === `packs/${pack}/${entry}`) ?? null;
    },
  };
}
