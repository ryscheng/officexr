import { createRng } from './rng.ts';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type BuildingKind = 'tower' | 'midrise' | 'lowrise';
export type BlockKind = 'downtown' | 'midtown' | 'residential' | 'park';

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  kind: BuildingKind;
}

export interface Block {
  i: number;
  j: number;
  kind: BlockKind;
  rect: Rect;
}

export interface Palm {
  x: number;
  z: number;
  height: number;
  yaw: number;
}

export interface Point {
  x: number;
  z: number;
}

export interface ParkedCar {
  x: number;
  z: number;
  yaw: number;
  color: string;
}

export interface Marking {
  x: number;
  z: number;
  w: number;
  d: number;
  tone: 'yellow' | 'white';
}

export interface SignalHead {
  x: number;
  z: number;
  axis: 'x' | 'z';
  yaw: number;
  intersection: number;
}

export interface Intersection {
  i: number;
  j: number;
  x: number;
  z: number;
}

export interface CityLayout {
  seed: number;
  blocksX: number;
  blocksZ: number;
  width: number;
  depth: number;
  xRoads: number[];
  zRoads: number[];
  intersections: Intersection[];
  blocks: Block[];
  buildings: Building[];
  palms: Palm[];
  lamps: Point[];
  parkedCars: ParkedCar[];
  markings: Marking[];
  signalHeads: SignalHead[];
  obstacles: Rect[];
  sand: Rect;
  waterZ: number;
  bounds: Rect;
}

export interface CityOptions {
  seed: number;
  blocksX?: number;
  blocksZ?: number;
}

export const BLOCK_SIZE = 46;
export const ROAD_WIDTH = 14;
export const SIDEWALK = 3;
export const PITCH = BLOCK_SIZE + ROAD_WIDTH;
export const LANE_OFFSET = 3.2;
export const PARKING_OFFSET = 5.7;
export const BEACH_DEPTH = 34;
const MARGIN = 22;

const LOWRISE_COLOURS = ['#f2a38a', '#f6c177', '#9ad1c4', '#f3e1b6', '#e58f9e', '#bfa8e0', '#8fc6e8'];
const MIDRISE_COLOURS = ['#e8957a', '#d9a7c7', '#7fc8c0', '#f0cf8a', '#c98f8f'];
const TOWER_COLOURS = ['#5a7fa8', '#6aa6b8', '#8d7fb0', '#4f6a8f', '#c47b8f'];
export const CAR_COLOURS = ['#ff6b57', '#ffc145', '#2ec4b6', '#f7f3e8', '#3a86ff', '#c77dff', '#1d2a44', '#ef476f'];

const rectAround = (x: number, z: number, hw: number, hd: number): Rect => ({
  minX: x - hw,
  maxX: x + hw,
  minZ: z - hd,
  maxZ: z + hd,
});

/** Unit heading to the right of `h` for a driver looking along it. */
export const rightOf = (hx: number, hz: number): [number, number] => [-hz, hx];

export function generateCity({ seed, blocksX = 6, blocksZ = 5 }: CityOptions): CityLayout {
  const rng = createRng(seed);
  const width = blocksX * PITCH + ROAD_WIDTH;
  const depth = blocksZ * PITCH + ROAD_WIDTH;
  const xRoads = Array.from({ length: blocksX + 1 }, (_, i) => -width / 2 + ROAD_WIDTH / 2 + i * PITCH);
  const zRoads = Array.from({ length: blocksZ + 1 }, (_, j) => -depth / 2 + ROAD_WIDTH / 2 + j * PITCH);
  const half = ROAD_WIDTH / 2;

  const intersections: Intersection[] = [];
  zRoads.forEach((z, j) => xRoads.forEach((x, i) => intersections.push({ i, j, x, z })));

  const buildings: Building[] = [];
  const palms: Palm[] = [];
  const lamps: Point[] = [];
  const blocks: Block[] = [];
  const obstacles: Rect[] = [];
  const maxDist = Math.hypot(blocksX, blocksZ) / 2;

  const addPalm = (x: number, z: number) => {
    palms.push({ x, z, height: rng.range(5.5, 8.5), yaw: rng.range(0, Math.PI * 2) });
    obstacles.push(rectAround(x, z, 0.35, 0.35));
  };
  const addLamp = (x: number, z: number) => {
    lamps.push({ x, z });
    obstacles.push(rectAround(x, z, 0.2, 0.2));
  };

  for (let j = 0; j < blocksZ; j++) {
    for (let i = 0; i < blocksX; i++) {
      const rect: Rect = {
        minX: xRoads[i]! + half,
        maxX: xRoads[i]! + half + BLOCK_SIZE,
        minZ: zRoads[j]! + half,
        maxZ: zRoads[j]! + half + BLOCK_SIZE,
      };
      const centrality = 1 - Math.hypot(i - (blocksX - 1) / 2, j - (blocksZ - 1) / 2) / maxDist;
      const isPark = rng.chance(0.12) && centrality < 0.85;
      const kind: BlockKind = isPark
        ? 'park'
        : centrality > 0.7
          ? 'downtown'
          : centrality > 0.4
            ? 'midtown'
            : 'residential';
      blocks.push({ i, j, kind, rect });

      const lot: Rect = {
        minX: rect.minX + SIDEWALK,
        maxX: rect.maxX - SIDEWALK,
        minZ: rect.minZ + SIDEWALK,
        maxZ: rect.maxZ - SIDEWALK,
      };
      if (isPark) {
        for (let n = 0; n < 16; n++) {
          addPalm(rng.range(lot.minX + 2, lot.maxX - 2), rng.range(lot.minZ + 2, lot.maxZ - 2));
        }
        continue;
      }
      const splitsX = kind === 'downtown' ? rng.int(1, 3) : rng.int(1, 4);
      const splitsZ = kind === 'downtown' ? rng.int(1, 3) : rng.int(1, 3);
      const alley = 3;
      const cellW = (lot.maxX - lot.minX - alley * (splitsX - 1)) / splitsX;
      const cellD = (lot.maxZ - lot.minZ - alley * (splitsZ - 1)) / splitsZ;
      for (let sz = 0; sz < splitsZ; sz++) {
        for (let sx = 0; sx < splitsX; sx++) {
          const w = cellW * rng.range(0.82, 1);
          const d = cellD * rng.range(0.82, 1);
          const x = lot.minX + sx * (cellW + alley) + cellW / 2;
          const z = lot.minZ + sz * (cellD + alley) + cellD / 2;
          const h = rng.range(7, 17) + centrality ** 1.6 * rng.range(20, 95);
          const bKind: BuildingKind = h > 55 ? 'tower' : h > 26 ? 'midrise' : 'lowrise';
          const colour = rng.pick(bKind === 'tower' ? TOWER_COLOURS : bKind === 'midrise' ? MIDRISE_COLOURS : LOWRISE_COLOURS);
          const b: Building = { x, z, w, d, h, color: colour, kind: bKind };
          buildings.push(b);
          obstacles.push(rectAround(x, z, w / 2, d / 2));
        }
      }
    }
  }

  for (const block of blocks) {
    const { rect } = block;
    const edges: { fixed: number; from: number; to: number; alongX: boolean; inward: number }[] = [
      { fixed: rect.minZ, from: rect.minX, to: rect.maxX, alongX: true, inward: 1 },
      { fixed: rect.maxZ, from: rect.minX, to: rect.maxX, alongX: true, inward: -1 },
      { fixed: rect.minX, from: rect.minZ, to: rect.maxZ, alongX: false, inward: 1 },
      { fixed: rect.maxX, from: rect.minZ, to: rect.maxZ, alongX: false, inward: -1 },
    ];
    for (const e of edges) {
      for (let t = e.from + 7; t <= e.to - 7; t += 13) {
        const pos = (offset: number): Point =>
          e.alongX ? { x: t, z: e.fixed + e.inward * offset } : { x: e.fixed + e.inward * offset, z: t };
        if (block.kind === 'park' || rng.chance(0.65)) {
          const p = pos(1.2);
          addPalm(p.x + (e.alongX ? rng.range(-1, 1) : 0), p.z + (e.alongX ? 0 : rng.range(-1, 1)));
        }
      }
      for (let t = e.from + 5; t <= e.to - 4; t += 18) {
        const p = e.alongX ? { x: t, z: e.fixed + e.inward * 0.6 } : { x: e.fixed + e.inward * 0.6, z: t };
        addLamp(p.x, p.z);
      }
    }
  }

  const sand: Rect = {
    minX: -width / 2 - MARGIN,
    maxX: width / 2 + MARGIN,
    minZ: depth / 2,
    maxZ: depth / 2 + BEACH_DEPTH,
  };
  for (let n = 0; n < 26; n++) {
    addPalm(rng.range(sand.minX + 6, sand.maxX - 6), sand.minZ + rng.range(7, BEACH_DEPTH - 9));
  }

  const markings: Marking[] = [];
  const signalHeads: SignalHead[] = [];
  const parkedCars: ParkedCar[] = [];
  const edgeClear = half + 4;

  const roadSegments: { axis: 'x' | 'z'; fixed: number; from: number; to: number }[] = [];
  for (const x of xRoads) {
    for (let j = 0; j < blocksZ; j++) roadSegments.push({ axis: 'z', fixed: x, from: zRoads[j]!, to: zRoads[j + 1]! });
  }
  for (const z of zRoads) {
    for (let i = 0; i < blocksX; i++) roadSegments.push({ axis: 'x', fixed: z, from: xRoads[i]!, to: xRoads[i + 1]! });
  }
  for (const seg of roadSegments) {
    const a = seg.from + edgeClear;
    const b = seg.to - edgeClear;
    const mid = (a + b) / 2;
    const len = b - a;
    for (const off of [-0.2, 0.2]) {
      markings.push(
        seg.axis === 'z'
          ? { x: seg.fixed + off, z: mid, w: 0.14, d: len, tone: 'yellow' }
          : { x: mid, z: seg.fixed + off, w: len, d: 0.14, tone: 'yellow' },
      );
    }
    for (const side of [-1, 1]) {
      for (let t = seg.from + half + 9; t <= seg.to - half - 8; t += 7.4) {
        if (!rng.chance(0.22)) continue;
        const along = t + rng.range(-0.4, 0.4);
        if (seg.axis === 'x') {
          parkedCars.push({
            x: along,
            z: seg.fixed + side * PARKING_OFFSET,
            yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2,
            color: rng.pick(CAR_COLOURS),
          });
        } else {
          parkedCars.push({
            x: seg.fixed + side * PARKING_OFFSET,
            z: along,
            yaw: side > 0 ? Math.PI : 0,
            color: rng.pick(CAR_COLOURS),
          });
        }
      }
    }
  }

  const hasX = (i: number) => i >= 0 && i <= blocksX;
  const hasZ = (j: number) => j >= 0 && j <= blocksZ;
  intersections.forEach((n, index) => {
    const arms: [number, number, boolean][] = [
      [1, 0, hasX(n.i + 1)],
      [-1, 0, hasX(n.i - 1)],
      [0, 1, hasZ(n.j + 1)],
      [0, -1, hasZ(n.j - 1)],
    ];
    for (const [dx, dz, exists] of arms) {
      if (!exists) continue;
      const incomingSide = rightOf(-dx, -dz);
      for (let k = -4; k <= 4; k++) {
        const lateral = k * 1.4;
        const dist = 9;
        const px = n.x + dx * dist + (dz !== 0 ? lateral : 0);
        const pz = n.z + dz * dist + (dx !== 0 ? lateral : 0);
        markings.push(
          dx !== 0
            ? { x: px, z: pz, w: 3, d: 0.7, tone: 'white' }
            : { x: px, z: pz, w: 0.7, d: 3, tone: 'white' },
        );
      }
      const lx = n.x + dx * 11.6 + incomingSide[0] * LANE_OFFSET;
      const lz = n.z + dz * 11.6 + incomingSide[1] * LANE_OFFSET;
      markings.push(
        dx !== 0
          ? { x: lx, z: lz, w: 0.5, d: 6, tone: 'white' }
          : { x: lx, z: lz, w: 6, d: 0.5, tone: 'white' },
      );
      const hx = n.x + dx * 8.5 + incomingSide[0] * 7.8;
      const hz = n.z + dz * 8.5 + incomingSide[1] * 7.8;
      signalHeads.push({
        x: hx,
        z: hz,
        axis: dx !== 0 ? 'x' : 'z',
        yaw: Math.atan2(dx, dz),
        intersection: index,
      });
    }
  });

  return {
    seed,
    blocksX,
    blocksZ,
    width,
    depth,
    xRoads,
    zRoads,
    intersections,
    blocks,
    buildings,
    palms,
    lamps,
    parkedCars,
    markings,
    signalHeads,
    obstacles,
    sand,
    waterZ: depth / 2 + BEACH_DEPTH,
    bounds: {
      minX: -width / 2 - MARGIN,
      maxX: width / 2 + MARGIN,
      minZ: -depth / 2 - MARGIN,
      maxZ: depth / 2 + BEACH_DEPTH - 2,
    },
  };
}
