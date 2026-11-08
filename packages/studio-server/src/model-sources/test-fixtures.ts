import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import type { ModelSourceStore } from './store.ts';

export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class InMemoryModelSourceStore implements ModelSourceStore {
  objects = new Map<string, { bytes: Uint8Array; sha256Meta: string | null }>();

  /** Stores `bytes` as a signed PUT would, with `sha256Meta` defaulting to their real digest. */
  put(key: string, bytes: Uint8Array, sha256Meta = sha(bytes)) {
    this.objects.set(key, { bytes, sha256Meta });
  }

  async signUpload(key: string, { sha256, sizeBytes }: { sha256: string; sizeBytes: number }) {
    return {
      url: `https://signed.test/${key}`,
      method: 'PUT' as const,
      headers: { 'x-goog-meta-sha256': sha256, 'x-goog-content-length-range': `${sizeBytes},${sizeBytes}` },
      expiresAt: new Date(0),
    };
  }

  async read(key: string) {
    return this.objects.get(key)?.bytes ?? null;
  }

  async stat(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.bytes.length, sha256Meta: o.sha256Meta } : null;
  }

  async list(prefix: string) {
    return [...this.objects]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => ({ key, sizeBytes: o.bytes.length, updated: new Date(0) }));
  }
}

/** A finely tessellated flat grid, which `simplify-aggressive` collapses to a few triangles. */
export function gridDoc(n = 24): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x / n, 0, z / n);
    }
  }
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * (n + 1) + x;
      indices.push(i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2);
    }
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh('grid').addPrimitive(prim)));
  return doc;
}

export const gridGlb = () => new NodeIO().writeBinary(gridDoc());
