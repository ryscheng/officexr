import { Document } from '@gltf-transform/core';

/** A one-triangle document with a single mesh named `meshName`, for tests that need a loadable model. */
export function triangleDoc(meshName = 'tri'): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const mesh = doc.createMesh(meshName).addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  return doc;
}
