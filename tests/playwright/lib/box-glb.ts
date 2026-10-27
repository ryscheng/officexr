/**
 * Smallest valid GLB that renders: one axis-aligned box from the origin to
 * `size` (metres) in a flat `color` (linear RGB, 0..1). Lets a spec serve a
 * "baked layout" without a bake pipeline.
 */
export function boxGlb(size: [number, number, number], color: [number, number, number]): Buffer {
  const [x, y, z] = size;
  const positions = new Float32Array([
    0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0,
    0, 0, z, x, 0, z, x, y, z, 0, y, z,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    0, 4, 7, 0, 7, 3, // -X
    1, 2, 6, 1, 6, 5, // +X
    0, 1, 5, 0, 5, 4, // -Y
    3, 7, 6, 3, 6, 2, // +Y
  ]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: size },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data]);
  };
  const body = Buffer.concat([chunk('JSON', jsonChunk), chunk('BIN\0', bin)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}
