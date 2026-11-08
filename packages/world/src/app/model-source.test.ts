import { Document, NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { readSourceGltf, type ModelSourceReader } from './model-source.ts';

function triangleDoc(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const mesh = doc.createMesh('tri').addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  return doc;
}

const mapReader = (files: Map<string, Uint8Array>): ModelSourceReader => ({
  read: async (key) => files.get(key) ?? null,
});

const meshNames = (doc: Document) => doc.getRoot().listMeshes().map((m) => m.getName());

describe('readSourceGltf', () => {
  it('reads a .glb directly', async () => {
    const glb = await new NodeIO().writeBinary(triangleDoc());
    const doc = await readSourceGltf(mapReader(new Map([['packs/p/a.glb', glb]])), 'packs/p/a.glb');
    expect(meshNames(doc)).toEqual(['tri']);
  });

  it('resolves a .gltf buffer and texture shared in the pack root', async () => {
    const source = triangleDoc();
    const { json, resources } = await new NodeIO().writeJSON(source);
    json.buffers![0].uri = '../shared%20bin.bin';
    const [[, bin]] = Object.entries(resources);
    json.images = [{ uri: 'tex.png' }];
    const files = new Map<string, Uint8Array>([
      ['packs/p/models/a.gltf', new TextEncoder().encode(JSON.stringify(json))],
      ['packs/p/shared bin.bin', bin],
      ['packs/p/models/tex.png', new Uint8Array([1, 2, 3])],
    ]);
    const doc = await readSourceGltf(mapReader(files), 'packs/p/models/a.gltf');
    expect(meshNames(doc)).toEqual(['tri']);
  });

  it('rejects a resource that escapes the pack', async () => {
    const { json } = await new NodeIO().writeJSON(triangleDoc());
    json.buffers![0].uri = '../../q/a.bin';
    const files = new Map([['packs/p/a.gltf', new TextEncoder().encode(JSON.stringify(json))]]);
    await expect(readSourceGltf(mapReader(files), 'packs/p/a.gltf')).rejects.toThrow('escapes its pack');
  });

  it('names a missing resource', async () => {
    const { json } = await new NodeIO().writeJSON(triangleDoc());
    json.buffers![0].uri = 'a.bin';
    const files = new Map([['packs/p/a.gltf', new TextEncoder().encode(JSON.stringify(json))]]);
    await expect(readSourceGltf(mapReader(files), 'packs/p/a.gltf')).rejects.toThrow('packs/p/a.bin');
  });
});
