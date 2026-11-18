import type { FootprintRect, ObjectInstance } from '@officexr/sdk';
import { classifyKind, isWooden, type Archetype, type ArchetypeKind } from './furnitureArchetype.ts';
import { unionBounds, type XZ, type XZBounds } from './topDownGeometry.ts';

/** A compass side of a box: n is -Z (the top of the view), e is +X. */
export type Side = 'n' | 'e' | 's' | 'w';

/** Where a workstation's chair meets a desk: the desk side it sits at, and how far along that side (0–1, west/north first). */
export interface DeskSeat {
  side: Side;
  t: number;
}

export interface SceneItem extends XZBounds {
  id: string;
  /** Which sprite to draw, at which yaw. */
  kindId: string;
  yawDeg: number;
  archetype: Archetype;
  /** Bottom and top of the world AABB, in metres. */
  minY: number;
  maxY: number;
  /** The side a chair's or sofa's backrest is on; null for unoriented objects. */
  back: Side | null;
  /** Desk sides that have a chair pulled up; the painter puts a monitor across from each. */
  seats: readonly DeskSeat[];
  wooden: boolean;
  /** Stable per-instance variety (rug colour, plant shape, book spines). */
  seed: number;
}

export interface TopDownScene {
  /** Floors and rugs: drawn first, never in front of anything. */
  floors: readonly SceneItem[];
  /** Everything with height, drawn back to front among the players. */
  items: readonly SceneItem[];
  byId: ReadonlyMap<string, SceneItem>;
  footprint: readonly FootprintRect[];
  /** What the camera may show: the footprint and every object, or null for an empty map. */
  bounds: XZBounds | null;
}

/** The facts `buildScene` needs about one instance; null skips it (e.g. a kind the catalog doesn't know yet). */
export type ResolveInstance = (instance: ObjectInstance) => {
  kind: ArchetypeKind;
  aabb: { min: readonly [number, number, number]; max: readonly [number, number, number] };
} | null;

const FLAT: ReadonlySet<Archetype> = new Set(['floor', 'rug']);
/** How far a chair's centre may sit outside a desk edge and still count as pulled up to it. */
const SEAT_REACH_M = 0.9;

/** FNV-1a, so one instance keeps its look across reloads. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The side a world direction points to, by its larger component. */
export function sideOf(dir: XZ): Side {
  return Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 'e' : 'w') : dir.z > 0 ? 's' : 'n';
}

/**
 * The KayKit seats have their backrest on -Z at yaw 0 (the baked sprites show it), and yaw
 * turns counter-clockwise seen from above, like `yawAboutCentre`.
 */
function backrestSide(instance: ObjectInstance, kind: ArchetypeKind): Side | null {
  if (!kind.seat) {
    return null;
  }
  const yaw = (((instance.yawDeg ?? 0) + kind.seat.yawDeg) * Math.PI) / 180;
  return sideOf({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
}

const centre = (b: XZBounds): XZ => ({ x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 });

/** The desk side `chair` is pulled up to, or null when it is too far from every side. */
export function deskSeatFor(desk: XZBounds, chair: XZBounds): DeskSeat | null {
  const c = centre(chair);
  const along = (lo: number, hi: number, v: number) => Math.min(1, Math.max(0, (v - lo) / Math.max(hi - lo, 1e-6)));
  const withinX = c.x >= desk.min.x && c.x <= desk.max.x;
  const withinZ = c.z >= desk.min.z && c.z <= desk.max.z;
  if (withinX && c.z < desk.min.z && desk.min.z - c.z <= SEAT_REACH_M) {
    return { side: 'n', t: along(desk.min.x, desk.max.x, c.x) };
  }
  if (withinX && c.z > desk.max.z && c.z - desk.max.z <= SEAT_REACH_M) {
    return { side: 's', t: along(desk.min.x, desk.max.x, c.x) };
  }
  if (withinZ && c.x < desk.min.x && desk.min.x - c.x <= SEAT_REACH_M) {
    return { side: 'w', t: along(desk.min.z, desk.max.z, c.z) };
  }
  if (withinZ && c.x > desk.max.x && c.x - desk.max.x <= SEAT_REACH_M) {
    return { side: 'e', t: along(desk.min.z, desk.max.z, c.z) };
  }
  return null;
}

/**
 * The 2D view's model of a map: each placed object classified, oriented and split into
 * floor and standing layers. Pure, so it is rebuilt only when the objects or catalog change.
 */
export function buildScene(
  instances: readonly ObjectInstance[],
  resolve: ResolveInstance,
  footprint: readonly FootprintRect[],
): TopDownScene {
  const all: SceneItem[] = [];
  for (const instance of instances) {
    const resolved = resolve(instance);
    if (!resolved) {
      continue;
    }
    const { kind, aabb } = resolved;
    const size = { width: aabb.max[0] - aabb.min[0], depth: aabb.max[2] - aabb.min[2], height: aabb.max[1] - aabb.min[1] };
    all.push({
      id: instance.id,
      kindId: instance.kindId,
      yawDeg: instance.yawDeg ?? 0,
      archetype: classifyKind(kind, size),
      min: { x: aabb.min[0], z: aabb.min[2] },
      max: { x: aabb.max[0], z: aabb.max[2] },
      minY: aabb.min[1],
      maxY: aabb.max[1],
      back: backrestSide(instance, kind),
      seats: [],
      wooden: isWooden(kind),
      seed: hashString(instance.id),
    });
  }
  const chairs = all.filter((item) => item.archetype === 'chair');
  const items = all.map((item) =>
    item.archetype === 'desk'
      ? { ...item, seats: chairs.map((chair) => deskSeatFor(item, chair)).filter((s): s is DeskSeat => s !== null) }
      : item,
  );
  return {
    floors: items.filter((item) => FLAT.has(item.archetype)),
    items: items.filter((item) => !FLAT.has(item.archetype)),
    byId: new Map(items.map((item) => [item.id, item])),
    footprint,
    bounds: unionBounds([...footprint, ...items]),
  };
}
