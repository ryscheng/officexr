import { LANE_OFFSET, PITCH, rightOf, type CityLayout } from './generate.ts';

export interface Piece {
  kind: 'line' | 'curve';
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  len: number;
}

export interface PathPose {
  x: number;
  z: number;
  yaw: number;
}

export type Heading = readonly [number, number];

export const HEADINGS: readonly Heading[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const STOP_DISTANCE = 14.5;
export const INTERSECTION_EDGE = 8.5;

export const axisOf = (h: Heading): 'x' | 'z' => (h[0] !== 0 ? 'x' : 'z');

export function nodePosition(city: CityLayout, i: number, j: number): { x: number; z: number } {
  return { x: city.xRoads[i]!, z: city.zRoads[j]! };
}

export function hasNode(city: CityLayout, i: number, j: number): boolean {
  return i >= 0 && i <= city.blocksX && j >= 0 && j <= city.blocksZ;
}

export function linePiece(ax: number, az: number, bx: number, bz: number): Piece {
  return { kind: 'line', ax, az, bx, bz, cx: (ax + bx) / 2, cz: (az + bz) / 2, len: Math.hypot(bx - ax, bz - az) };
}

function curvePiece(ax: number, az: number, cx: number, cz: number, bx: number, bz: number): Piece {
  let len = 0;
  let px = ax;
  let pz = az;
  for (let n = 1; n <= 12; n++) {
    const t = n / 12;
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const z = u * u * az + 2 * u * t * cz + t * t * bz;
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return { kind: 'curve', ax, az, bx, bz, cx, cz, len };
}

export function samplePiece(piece: Piece, s: number): PathPose {
  const t = piece.len > 0 ? Math.min(Math.max(s / piece.len, 0), 1) : 1;
  const u = 1 - t;
  const x = u * u * piece.ax + 2 * u * t * piece.cx + t * t * piece.bx;
  const z = u * u * piece.az + 2 * u * t * piece.cz + t * t * piece.bz;
  const dx = 2 * u * (piece.cx - piece.ax) + 2 * t * (piece.bx - piece.cx);
  const dz = 2 * u * (piece.cz - piece.az) + 2 * t * (piece.bz - piece.cz);
  return { x, z, yaw: Math.atan2(dx, dz) };
}

/** The lane point `along` units past node `(i, j)` on the lane for heading `h`. */
export function lanePoint(city: CityLayout, i: number, j: number, h: Heading, along: number): { x: number; z: number } {
  const n = nodePosition(city, i, j);
  const [rx, rz] = rightOf(h[0], h[1]);
  return { x: n.x + h[0] * along + rx * LANE_OFFSET, z: n.z + h[1] * along + rz * LANE_OFFSET };
}

/** From the exit of node `(i, j)` along `h` to the stop line before the next node. */
export function approachPiece(city: CityLayout, i: number, j: number, h: Heading): Piece {
  const a = lanePoint(city, i, j, h, INTERSECTION_EDGE);
  const b = lanePoint(city, i, j, h, PITCH - STOP_DISTANCE);
  return linePiece(a.x, a.z, b.x, b.z);
}

/** From the stop line of node `(i, j)` (reached heading `h`) out along `out`. */
export function turnPiece(city: CityLayout, i: number, j: number, h: Heading, out: Heading): Piece {
  const a = lanePoint(city, i, j, h, -STOP_DISTANCE);
  const b = lanePoint(city, i, j, out, INTERSECTION_EDGE);
  if (h[0] === out[0] && h[1] === out[1]) return linePiece(a.x, a.z, b.x, b.z);
  const n = nodePosition(city, i, j);
  const [rx, rz] = rightOf(h[0], h[1]);
  const [ox, oz] = rightOf(out[0], out[1]);
  return curvePiece(a.x, a.z, n.x + (rx + ox) * LANE_OFFSET, n.z + (rz + oz) * LANE_OFFSET, b.x, b.z);
}

export function availableHeadings(city: CityLayout, i: number, j: number): Heading[] {
  return HEADINGS.filter((h) => hasNode(city, i + h[0], j + h[1]));
}
