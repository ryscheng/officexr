import { Document, NodeIO } from '@gltf-transform/core';

/**
 * Smallest GLB that renders: one flat-coloured box from the origin to `size`
 * (metres), `color` being linear RGB 0..1. Lets a spec serve a "baked
 * layout" without a bake pipeline.
 */
export function boxGlb(size: [number, number, number], color: [number, number, number]): Promise<Uint8Array> {
  const [x, y, z] = size;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0, 0, 0, z, x, 0, z, x, y, z, 0, y, z]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(
      new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2]),
    )
    .setBuffer(buffer);
  const material = doc.createMaterial().setBaseColorFactor([...color, 1]).setMetallicFactor(0);
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices).setMaterial(material);
  const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive));
  doc.createScene().addChild(node);
  return new NodeIO().writeBinary(doc);
}
