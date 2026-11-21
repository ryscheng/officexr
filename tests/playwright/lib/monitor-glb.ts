import { Document, NodeIO } from '@gltf-transform/core';

export const MONITOR_DIMENSIONS = { width: 0.6, height: 0.5, depth: 0.12 };

type Box = { min: [number, number, number]; max: [number, number, number]; color: [number, number, number] };

const FRAME: [number, number, number] = [0.05, 0.05, 0.06];
const SCREEN: [number, number, number] = [0.01, 0.015, 0.03];
const CUBE_FACES = [
  [1, 5, 7, 3],
  [4, 0, 2, 6],
  [4, 6, 7, 5],
  [0, 1, 3, 2],
  [2, 3, 7, 6],
  [0, 4, 5, 1],
];

/**
 * A single-mesh, single-material desk monitor, bottom-centred with its screen toward +z: a stand, a bezel
 * frame, and a screen panel standing 2 cm proud of the frame. Colour comes from vertex colours, so it
 * renders like a catalog kind (one geometry, one material).
 */
export function monitorGlb(): Promise<Uint8Array> {
  const stand = { y0: 0.0, y1: 0.15 };
  const bodyY0 = stand.y1;
  const bodyY1 = bodyY0 + 0.35;
  const boxes: Box[] = [
    { min: [-0.12, 0, -0.06], max: [0.12, 0.015, 0.06], color: FRAME },
    { min: [-0.02, 0.015, -0.02], max: [0.02, stand.y1, 0.02], color: FRAME },
    { min: [-0.3, bodyY0, -0.02], max: [0.3, bodyY0 + 0.02, 0.02], color: FRAME },
    { min: [-0.3, bodyY1 - 0.02, -0.02], max: [0.3, bodyY1, 0.02], color: FRAME },
    { min: [-0.3, bodyY0 + 0.02, -0.02], max: [-0.28, bodyY1 - 0.02, 0.02], color: FRAME },
    { min: [0.28, bodyY0 + 0.02, -0.02], max: [0.3, bodyY1 - 0.02, 0.02], color: FRAME },
    { min: [-0.28, bodyY0 + 0.02, -0.02], max: [0.28, bodyY1 - 0.02, 0.04], color: SCREEN },
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const { min, max, color } of boxes) {
    const base = positions.length / 3;
    for (let i = 0; i < 8; i++) {
      positions.push(i & 4 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 1 ? max[2] : min[2]);
      colors.push(...color);
    }
    for (const [a, b, c, d] of CUBE_FACES) indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type: 'VEC3' | 'SCALAR', array: Float32Array | Uint16Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const material = doc.createMaterial().setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
    .setAttribute('COLOR_0', accessor('VEC3', new Float32Array(colors)))
    .setIndices(accessor('SCALAR', new Uint16Array(indices)))
    .setMaterial(material);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)));
  return new NodeIO().writeBinary(doc);
}
