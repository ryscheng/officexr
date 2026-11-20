import {
  PLACEABLE_KINDS,
  PLACE_STEP_VOXELS,
  rotateYaw,
  snapToGrid,
  type PlaceableKindId,
  type PlacedProp,
  type PropOp,
  type PropOpResult,
  type Vec3,
} from '@officexr/sdk';
import type { InstanceGeometryService } from '../app/types.ts';

export interface GhostState {
  /** Footprint corner in voxels, like a map instance. */
  position: [number, number, number];
  valid: boolean;
  targetId: string | null;
}

export interface PlaceModeState {
  open: boolean;
  kindId: PlaceableKindId;
  yawDeg: number;
  ghost: GhostState | null;
  notice: string | null;
}

export interface PlaceModeStore {
  get(): PlaceModeState;
  subscribe(listener: () => void): () => void;
  setOpen(open: boolean): void;
  selectKind(kindId: PlaceableKindId): void;
  setYaw(yawDeg: number): void;
  rotate(): void;
  setGhost(ghost: GhostState | null): void;
  setNotice(notice: string | null): void;
  /** Places at the ghost, as Enter does; the scene registers what that means. */
  place(): void;
  onPlace(handler: () => void): () => void;
}

export interface PlacementHost {
  mode: PlaceModeStore;
  send(op: PropOp): Promise<PropOpResult>;
}

const sameGhost = (a: GhostState | null, b: GhostState | null) =>
  a === b || (!!a && !!b && a.valid === b.valid && a.targetId === b.targetId && a.position.every((v, i) => v === b.position[i]));

export function createPlaceMode(): PlaceModeStore {
  let state: PlaceModeState = { open: false, kindId: PLACEABLE_KINDS[0].kindId, yawDeg: 0, ghost: null, notice: null };
  const listeners = new Set<() => void>();
  let placeHandler: (() => void) | null = null;
  const set = (patch: Partial<PlaceModeState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOpen: (open) => set(open ? { open } : { open, ghost: null, notice: null }),
    selectKind: (kindId) => set({ kindId }),
    setYaw: (yawDeg) => set({ yawDeg }),
    rotate: () => set({ yawDeg: rotateYaw(state.yawDeg) }),
    setGhost(ghost) {
      if (!sameGhost(state.ghost, ghost)) set({ ghost });
    },
    setNotice: (notice) => set({ notice }),
    place: () => placeHandler?.(),
    onPlace(handler) {
      placeHandler = handler;
      return () => {
        if (placeHandler === handler) placeHandler = null;
      };
    },
  };
}

export const PLACE_AHEAD_M = 3;
export const TARGET_REACH_M = 1.6;

type Geometry = Pick<InstanceGeometryService, 'worldAABB' | 'worldAABBOfInstance'>;

export function ghostSpot(
  geometry: Geometry,
  voxelSize: number,
  feet: Vec3,
  yaw: number,
  kindId: PlaceableKindId,
  yawDeg: number,
): [number, number, number] {
  const y = Math.round((feet.y / voxelSize) * 2) / 2;
  const { min, max } = geometry.worldAABB([0, y, 0], kindId, yawDeg);
  const aheadX = feet.x - Math.sin(yaw) * PLACE_AHEAD_M;
  const aheadZ = feet.z - Math.cos(yaw) * PLACE_AHEAD_M;
  const cornerX = aheadX - (max[0] - min[0]) / 2;
  const cornerZ = aheadZ - (max[2] - min[2]) / 2;
  return [snapToGrid(cornerX / voxelSize), y, snapToGrid(cornerZ / voxelSize)];
}

const overlaps = (a: { min: readonly number[]; max: readonly number[] }, b: { min: readonly number[]; max: readonly number[] }) =>
  a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2] && a.min[1] < b.max[1] && a.max[1] > b.min[1];

export function fitsClear(
  geometry: Geometry,
  placed: readonly PlacedProp[],
  kindId: PlaceableKindId,
  position: [number, number, number],
  yawDeg: number,
  ignoreId?: string,
): boolean {
  const box = geometry.worldAABB(position, kindId, yawDeg);
  return !placed.some((p) => p.id !== ignoreId && overlaps(box, geometry.worldAABBOfInstance({ id: p.id, sourceCommandId: p.id, kindId: p.kindId, position: p.position, yawDeg: p.yawDeg })));
}

export function pickPlaced(geometry: Geometry, placed: readonly PlacedProp[], point: { x: number; z: number }): string | null {
  let best: string | null = null;
  let bestDistance = TARGET_REACH_M;
  for (const p of placed) {
    const { min, max } = geometry.worldAABBOfInstance({ id: p.id, sourceCommandId: p.id, kindId: p.kindId, position: p.position, yawDeg: p.yawDeg });
    const distance = Math.hypot(Math.max(min[0] - point.x, 0, point.x - max[0]), Math.max(min[2] - point.z, 0, point.z - max[2]));
    if (distance < bestDistance) {
      best = p.id;
      bestDistance = distance;
    }
  }
  return best;
}

export const PLACE_ERROR_TEXT: Record<Extract<PropOpResult, { ok: false }>['error'], string> = {
  invalid: 'That spot is not allowed.',
  limit: 'This office has the most props it can hold.',
  'not-found': 'That prop is already gone.',
  unavailable: 'Building is not available right now.',
};

export { PLACE_STEP_VOXELS };
