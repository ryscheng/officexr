import { NodeIO, type Document } from '@gltf-transform/core';
import { registerCompressionCodecs } from './glb-compression.ts';

/**
 * Reads raw model sources by object key; `null` when the key does not exist.
 * Keys are raw object keys: the reader must not URL-decode or interpret them.
 */
export interface ModelSourceReader {
  read(key: string): Promise<Uint8Array | null>;
}

interface GltfResourceRef {
  uri?: string;
}

interface GltfJson {
  buffers?: GltfResourceRef[];
  images?: GltfResourceRef[];
}

/** Resolves `uri` against the entry's directory; throws if it leaves the entry's `packs/<pack>/` prefix. */
function resolveInPack(entryKey: string, uri: string): string {
  const packPrefix = entryKey.split('/').slice(0, 2).join('/') + '/';
  const segments = entryKey.split('/').slice(0, -1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error(`model source "${entryKey}": resource "${uri}" is not a valid URI`);
  }
  for (const seg of decoded.split('/')) {
    if (seg === '..') {
      segments.pop();
    } else if (seg !== '.' && seg !== '') {
      segments.push(seg);
    }
  }
  const key = segments.join('/');
  if (!key.startsWith(packPrefix)) {
    throw new Error(`model source "${entryKey}": resource "${uri}" escapes its pack`);
  }
  return key;
}

/** Loads a `.glb`, or a `.gltf` with its buffers and images, from `reader` into a document. */
export async function readSourceGltf(reader: ModelSourceReader, entryKey: string): Promise<Document> {
  const io = await registerCompressionCodecs(new NodeIO());
  const entry = await reader.read(entryKey);
  if (!entry) {
    throw new Error(`model source "${entryKey}" not found`);
  }
  if (!entryKey.endsWith('.gltf')) {
    return io.readBinary(entry);
  }
  const json = JSON.parse(new TextDecoder().decode(entry)) as GltfJson;
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!ref.uri || ref.uri.startsWith('data:')) {
      continue;
    }
    const key = resolveInPack(entryKey, ref.uri);
    const bytes = await reader.read(key);
    if (!bytes) {
      throw new Error(`model source "${entryKey}": resource "${key}" not found`);
    }
    resources[ref.uri] = bytes as Uint8Array<ArrayBuffer>;
  }
  return io.readJSON({ json: json as never, resources });
}
