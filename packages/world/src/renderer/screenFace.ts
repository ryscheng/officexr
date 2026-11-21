import * as THREE from 'three';

export const SCREEN_FACE_ATTRIBUTE = 'screenFace';
export const MAX_SCREEN_FACES = 6;
export const NEAR_VERTICAL_MAX_NY = 0.26;
export const FACING_MIN_DOT = 0.5;
export const MIN_FACE_AREA_RATIO = 0.25;

export interface ScreenFace {
  id: number;
  nx: number;
  nz: number;
  area: number;
}

export interface ScreenFaces {
  geometry: THREE.BufferGeometry;
  faces: ScreenFace[];
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const n = new THREE.Vector3();

// Candidates are the largest coplanar, near-vertical faces (at least a quarter of the biggest, so sides are left out).
// Each gets an id in a per-vertex attribute on a non-indexed copy, so no vertex is shared with a neighbouring face.
export function findScreenFaces(source: THREE.BufferGeometry): ScreenFaces | null {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position');
  const triangles = position.count / 3;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = (geometry.boundingBox as THREE.Box3).getSize(new THREE.Vector3());
  const planeStep = Math.max(size.x, size.y, size.z) * 0.01;

  const clusters = new Map<string, { area: number; nx: number; nz: number; triangles: number[] }>();
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const area = n.length() / 2;
    if (area < 1e-12) continue;
    n.normalize();
    if (Math.abs(n.y) > NEAR_VERTICAL_MAX_NY) continue;
    const key = [Math.round(n.x * 20), Math.round(n.z * 20), Math.round(n.dot(a) / planeStep)].join(',');
    const cluster = clusters.get(key) ?? { area: 0, nx: 0, nz: 0, triangles: [] };
    cluster.area += area;
    cluster.nx += n.x * area;
    cluster.nz += n.z * area;
    cluster.triangles.push(t);
    clusters.set(key, cluster);
  }

  const ranked = [...clusters.values()].sort((p, q) => q.area - p.area);
  if (ranked.length === 0) return null;
  const top = ranked.slice(0, MAX_SCREEN_FACES).filter((cluster) => cluster.area >= ranked[0].area * MIN_FACE_AREA_RATIO);
  const ids = new Float32Array(position.count);
  const faces = top.map((cluster, i) => {
    for (const t of cluster.triangles) ids.fill(i + 1, t * 3, t * 3 + 3);
    const len = Math.hypot(cluster.nx, cluster.nz) || 1;
    return { id: i + 1, nx: cluster.nx / len, nz: cluster.nz / len, area: cluster.area };
  });
  geometry.setAttribute(SCREEN_FACE_ATTRIBUTE, new THREE.BufferAttribute(ids, 1));
  return { geometry, faces };
}

// The largest candidate whose normal, turned by the instance's yaw, points at the target; 0 when none does.
export function chooseScreenFace(faces: readonly ScreenFace[], yawRad: number, toX: number, toZ: number): number {
  const len = Math.hypot(toX, toZ);
  if (len < 1e-9) return 0;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  let best = 0;
  let bestArea = 0;
  for (const f of faces) {
    const wx = f.nx * cos + f.nz * sin;
    const wz = -f.nx * sin + f.nz * cos;
    if ((wx * toX + wz * toZ) / len >= FACING_MIN_DOT && f.area > bestArea) {
      best = f.id;
      bestArea = f.area;
    }
  }
  return best;
}
