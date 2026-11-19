#!/usr/bin/env tsx
// Usage: pnpm --filter @officexr/world exec tsx scripts/generate-prop-models.ts
// Models face +Z; origin is the footprint centre at ground level.
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../studio/public/models/props');

let SIZE = 1;

type Mesh = { positions: number[]; normals: number[]; indices: number[] };

const empty = (): Mesh => ({ positions: [], normals: [], indices: [] });

function addBox(m: Mesh, cx: number, cy: number, cz: number, w: number, h: number, d: number) {
  [cx, cy, cz, w, h, d] = [cx, cy, cz, w, h, d].map((v) => v * SIZE) as [number, number, number, number, number, number];
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  for (const [normal, corners] of faces) {
    const base = m.positions.length / 3;
    for (const [sx, sy, sz] of corners) {
      m.positions.push(cx + (sx * w) / 2, cy + (sy * h) / 2, cz + (sz * d) / 2);
      m.normals.push(...normal);
    }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function addWheel(m: Mesh, cx: number, cy: number, cz: number, radius: number, width: number, segments = 14) {
  [cx, cy, cz, radius, width] = [cx, cy, cz, radius, width].map((v) => v * SIZE) as [number, number, number, number, number];
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const base = m.positions.length / 3;
    for (const [a, x] of [[a0, -1], [a0, 1], [a1, 1], [a1, -1]] as const) {
      m.positions.push(cx + (x * width) / 2, cy + Math.sin(a) * radius, cz + Math.cos(a) * radius);
      m.normals.push(0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2));
    }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    for (const x of [-1, 1]) {
      const cap = m.positions.length / 3;
      m.positions.push(cx + (x * width) / 2, cy, cz, cx + (x * width) / 2, cy + Math.sin(a0) * radius, cz + Math.cos(a0) * radius, cx + (x * width) / 2, cy + Math.sin(a1) * radius, cz + Math.cos(a1) * radius);
      m.normals.push(x, 0, 0, x, 0, 0, x, 0, 0);
      m.indices.push(...(x > 0 ? [cap, cap + 1, cap + 2] : [cap, cap + 2, cap + 1]));
    }
  }
}

function build(name: string, parts: { mesh: Mesh; color: [number, number, number]; emissive?: [number, number, number]; roughness?: number; metalness?: number }[]) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const node = doc.createNode(name);
  scene.addChild(node);
  const mesh = doc.createMesh(name);
  for (const part of parts) {
    const material: Material = doc
      .createMaterial()
      .setBaseColorFactor([...part.color, 1])
      .setRoughnessFactor(part.roughness ?? 0.7)
      .setMetallicFactor(part.metalness ?? 0)
      .setEmissiveFactor(part.emissive ? (part.emissive.map((v) => v * 0.35) as [number, number, number]) : [0, 0, 0]);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.mesh.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.mesh.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(part.mesh.indices)).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  node.setMesh(mesh);
  return doc;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
};

function pool() {
  SIZE = 1;
  const size = 4.5;
  const rim = 0.35;
  const height = 0.45;
  const stone = empty();
  addBox(stone, -size / 2 + rim / 2, height / 2, 0, rim, height, size);
  addBox(stone, size / 2 - rim / 2, height / 2, 0, rim, height, size);
  addBox(stone, 0, height / 2, -size / 2 + rim / 2, size - 2 * rim, height, rim);
  addBox(stone, 0, height / 2, size / 2 - rim / 2, size - 2 * rim, height, rim);
  const tile = empty();
  addBox(tile, 0, 0.015, 0, size - 2 * rim, 0.03, size - 2 * rim);
  return build('pool', [
    { mesh: stone, color: rgb('#efe3cf'), roughness: 0.85 },
    { mesh: tile, color: rgb('#58c4d8'), roughness: 0.4 },
  ]);
}

function scooter() {
  SIZE = 1.5;
  const deck = empty();
  addBox(deck, 0, 0.1, 0, 0.36, 0.08, 0.95);
  const metal = empty();
  addBox(metal, 0, 0.46, 0.56, 0.07, 0.72, 0.07);
  addBox(metal, 0, 0.82, 0.56, 0.62, 0.06, 0.06);
  addBox(metal, 0, 0.16, 0.56, 0.1, 0.14, 0.1);
  const rubber = empty();
  addWheel(rubber, 0, 0.14, 0.64, 0.14, 0.1);
  addWheel(rubber, 0, 0.14, -0.58, 0.14, 0.1);
  const grips = empty();
  addBox(grips, -0.36, 0.82, 0.56, 0.14, 0.08, 0.08);
  addBox(grips, 0.36, 0.82, 0.56, 0.14, 0.08, 0.08);
  const glow = empty();
  addBox(glow, 0, 0.15, 0.2, 0.3, 0.02, 0.5);
  return build('scooter', [
    { mesh: deck, color: rgb('#ff4f2e'), emissive: rgb('#ff4f2e'), roughness: 0.5 },
    { mesh: metal, color: rgb('#e8eef5'), roughness: 0.3, metalness: 0.4 },
    { mesh: rubber, color: rgb('#2a2b34'), roughness: 0.9 },
    { mesh: grips, color: rgb('#ffe14d'), emissive: rgb('#ffe14d') },
    { mesh: glow, color: rgb('#fff3c4'), emissive: rgb('#fff3c4') },
  ]);
}

/** Seat centred on the origin, where the rider's root rests: 0.34 up, times SIZE. */
function tricycle() {
  SIZE = 1.6;
  const frame = empty();
  addBox(frame, 0, 0.26, 0.28, 0.08, 0.08, 0.7);
  addBox(frame, 0, 0.48, 0.58, 0.08, 0.5, 0.08);
  addBox(frame, 0, 0.76, 0.58, 0.58, 0.06, 0.06);
  addBox(frame, 0, 0.2, -0.2, 0.62, 0.06, 0.06);
  const seat = empty();
  addBox(seat, 0, 0.31, -0.02, 0.4, 0.06, 0.4);
  const rubber = empty();
  addWheel(rubber, 0, 0.22, 0.58, 0.22, 0.1);
  addWheel(rubber, -0.34, 0.14, -0.2, 0.14, 0.08);
  addWheel(rubber, 0.34, 0.14, -0.2, 0.14, 0.08);
  const pedals = empty();
  addBox(pedals, -0.16, 0.06, 0.28, 0.12, 0.04, 0.2);
  addBox(pedals, 0.16, 0.06, 0.28, 0.12, 0.04, 0.2);
  const grips = empty();
  addBox(grips, -0.34, 0.76, 0.58, 0.14, 0.08, 0.08);
  addBox(grips, 0.34, 0.76, 0.58, 0.14, 0.08, 0.08);
  return build('tricycle', [
    { mesh: frame, color: rgb('#12d6b9'), emissive: rgb('#12d6b9'), roughness: 0.4 },
    { mesh: seat, color: rgb('#ffd23f'), emissive: rgb('#ffd23f') },
    { mesh: rubber, color: rgb('#2a2b34'), roughness: 0.9 },
    { mesh: pedals, color: rgb('#ff3d6e'), emissive: rgb('#ff3d6e') },
    { mesh: grips, color: rgb('#ff3d6e'), emissive: rgb('#ff3d6e') },
  ]);
}

function wandStand(withWand: boolean) {
  SIZE = 1;
  const stone = empty();
  addBox(stone, 0, 0.04, 0, 0.7, 0.08, 0.7);
  addBox(stone, 0, 0.42, 0, 0.2, 0.7, 0.2);
  addBox(stone, 0, 0.8, 0, 0.5, 0.06, 0.5);
  const trim = empty();
  addBox(trim, 0, 0.1, 0, 0.74, 0.04, 0.74);
  addBox(trim, 0, 0.84, 0, 0.54, 0.03, 0.54);
  const parts = [
    { mesh: stone, color: rgb('#5b3ea6'), emissive: rgb('#5b3ea6'), roughness: 0.6 },
    { mesh: trim, color: rgb('#ffd23f'), emissive: rgb('#ffd23f'), roughness: 0.4 },
  ];
  if (withWand) {
    const shaft = empty();
    addBox(shaft, 0, 1.12, 0, 0.045, 0.55, 0.045);
    const tip = empty();
    addBox(tip, 0, 1.42, 0, 0.1, 0.1, 0.1);
    parts.push({ mesh: shaft, color: rgb('#6b3f1d'), emissive: rgb('#000000'), roughness: 0.8 }, { mesh: tip, color: rgb('#fff3c4'), emissive: rgb('#ffe27a'), roughness: 0.3 });
  }
  return build(withWand ? 'wand_stand' : 'wand_stand_empty', parts);
}

mkdirSync(OUT_DIR, { recursive: true });
const io = new NodeIO();
for (const [file, doc] of [['pool.gltf', pool()], ['scooter.gltf', scooter()], ['tricycle.gltf', tricycle()], ['wand_stand.gltf', wandStand(true)], ['wand_stand_empty.gltf', wandStand(false)]] as const) {
  await io.write(resolve(OUT_DIR, file), doc);
  console.log('wrote', file);
}
