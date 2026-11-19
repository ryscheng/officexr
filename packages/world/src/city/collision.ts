import type { Rect } from './generate.ts';

export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}

export interface CollisionWorld {
  query(x: number, z: number, radius: number): readonly Rect[];
  bounds: Rect;
}

const CELL = 24;

export function createCollisionWorld(rects: readonly Rect[], bounds: Rect): CollisionWorld {
  const cells = new Map<number, Rect[]>();
  const key = (cx: number, cz: number) => cx * 100003 + cz;
  for (const rect of rects) {
    for (let cx = Math.floor(rect.minX / CELL); cx <= Math.floor(rect.maxX / CELL); cx++) {
      for (let cz = Math.floor(rect.minZ / CELL); cz <= Math.floor(rect.maxZ / CELL); cz++) {
        const k = key(cx, cz);
        const bucket = cells.get(k);
        if (bucket) bucket.push(rect);
        else cells.set(k, [rect]);
      }
    }
  }
  return {
    bounds,
    query(x, z, radius) {
      const found = new Set<Rect>();
      for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
        for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
          for (const rect of cells.get(key(cx, cz)) ?? []) found.add(rect);
        }
      }
      return [...found];
    },
  };
}

export function circleVsRect(cx: number, cz: number, radius: number, rect: Rect): Contact | null {
  const px = Math.min(Math.max(cx, rect.minX), rect.maxX);
  const pz = Math.min(Math.max(cz, rect.minZ), rect.maxZ);
  const dx = cx - px;
  const dz = cz - pz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) return null;
  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    return { nx: dx / dist, nz: dz / dist, depth: radius - dist };
  }
  const left = cx - rect.minX;
  const right = rect.maxX - cx;
  const top = cz - rect.minZ;
  const bottom = rect.maxZ - cz;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { nx: -1, nz: 0, depth: left + radius };
  if (min === right) return { nx: 1, nz: 0, depth: right + radius };
  if (min === top) return { nx: 0, nz: -1, depth: top + radius };
  return { nx: 0, nz: 1, depth: bottom + radius };
}

export function circleVsBounds(cx: number, cz: number, radius: number, bounds: Rect): Contact[] {
  const contacts: Contact[] = [];
  if (cx - radius < bounds.minX) contacts.push({ nx: 1, nz: 0, depth: bounds.minX - (cx - radius) });
  if (cx + radius > bounds.maxX) contacts.push({ nx: -1, nz: 0, depth: cx + radius - bounds.maxX });
  if (cz - radius < bounds.minZ) contacts.push({ nx: 0, nz: 1, depth: bounds.minZ - (cz - radius) });
  if (cz + radius > bounds.maxZ) contacts.push({ nx: 0, nz: -1, depth: cz + radius - bounds.maxZ });
  return contacts;
}

export function circleContacts(world: CollisionWorld, cx: number, cz: number, radius: number): Contact[] {
  const contacts = circleVsBounds(cx, cz, radius, world.bounds);
  for (const rect of world.query(cx, cz, radius)) {
    const hit = circleVsRect(cx, cz, radius, rect);
    if (hit) contacts.push(hit);
  }
  return contacts;
}
