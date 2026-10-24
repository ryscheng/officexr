import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { NodeIO, WebIO } from '@gltf-transform/core';
import { dequantize } from '@gltf-transform/functions';
import { compressDocument, registerCompressionCodecs } from '../glb-compression.ts';
import { bakeLayout } from '../layout-bake-service.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import { extractGeometryFromGltf } from '../../renderer/cube-material.ts';
import type { WorldObjectKind } from '../../scenes/world-object-kinds-schema.ts';
import type { LayoutDocument } from '../../scenes/layout-document.ts';

const BLOCKS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../studio/public/models/blocks',
);

function makeKind(id: string, gltfPath: string): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath,
    swatch: '#fff',
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: 'block',
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    isLayoutObject: true,
    optimization: 'none',
  };
}

async function readIo() {
  const io = await registerCompressionCodecs(new WebIO());
  return io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

describe('compression', () => {
  it('bakes a smaller GLB with meshopt + quantization and unchanged collider extras', async () => {
    const kinds = new Map([
      ['stone', makeKind('stone', 'stone.gltf')],
      ['red', makeKind('red', 'colored_block_red.gltf')],
    ]);
    const doc: LayoutDocument = {
      schemaVersion: 1,
      name: 'compress',
      updatedAt: 0,
      commands: [
        { id: 'a', op: 'placeObject', kindId: 'stone', position: [0, 0, 0] },
        { id: 'b', op: 'placeObject', kindId: 'red', position: [3, 0, 0] },
      ],
    };
    const nodeIo = new NodeIO();
    const loader = async (url: string) =>
      nodeIo.writeBinary(await nodeIo.read(path.join(BLOCKS_DIR, url)));
    const geometry = createInstanceGeometry({
      catalog: { getKind: (id: string) => kinds.get(id) },
      voxelSize: 0.5,
    });

    const { glb } = await bakeLayout(doc, (id) => kinds.get(id), loader, geometry);

    const json = JSON.parse(
      Buffer.from(glb.slice(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))).toString(),
    );
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.extensionsUsed).toContain('KHR_mesh_quantization');

    const compressed = await (await readIo()).readBinary(glb);
    const reference = await (await readIo()).readBinary(glb);
    await reference.transform(dequantize());
    reference.getRoot().listExtensionsUsed().forEach((ext) => ext.dispose());
    const uncompressed = await new WebIO().writeBinary(reference);

    expect(glb.length).toBeLessThan(uncompressed.length);
    const reread = await new WebIO().readBinary(uncompressed);
    expect(compressed.getRoot().listScenes()[0].getExtras()).toEqual(
      reread.getRoot().listScenes()[0].getExtras(),
    );
  });

  it('keeps a kind model the same size once the node transform is applied', async () => {
    const io = new NodeIO();
    const original = await io.read(path.join(BLOCKS_DIR, 'stone.gltf'));
    const packed = await io.read(path.join(BLOCKS_DIR, 'stone.gltf'));
    // three's GLTFLoader needs DOM image decoding for textures; geometry is all we compare.
    for (const d of [original, packed]) {
      d.getRoot().listTextures().forEach((t) => t.dispose());
    }
    await registerCompressionCodecs(io);
    await packed.transform(compressDocument);
    const packedBytes = await io.writeBinary(packed);
    const originalBytes = await new NodeIO().writeBinary(original);

    const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
    const parse = async (bytes: Uint8Array) => {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return (await loader.parseAsync(buf as ArrayBuffer, '')).scene;
    };
    const box = async (bytes: Uint8Array) =>
      new THREE.Box3().setFromBufferAttribute(
        extractGeometryFromGltf(await parse(bytes)).getAttribute('position') as THREE.BufferAttribute,
      );

    const a = await box(originalBytes);
    const b = await box(packedBytes);
    for (const key of ['min', 'max'] as const) {
      expect(b[key].distanceTo(a[key])).toBeLessThan(0.001);
    }
  });
});
