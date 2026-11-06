import RAPIER from '@dimforge/rapier3d-compat';
import type { RapierRigidBody } from '@react-three/rapier';
import type { Vec3 } from '@officexr/sdk';

/** What the frame loop needs from the seating controller. */
export interface SeatingSource {
  /** Sits on the nearest seat, if any. */
  sit(): void;
  stand(): void;
  /** Installs the test `stand` uses for a collider-free spot; returns its removal. */
  setStandingCheck(isFree: (feet: Vec3) => boolean): () => void;
}

/** Lifts the probe off the floor so the floor itself doesn't count as an obstacle. */
const FLOOR_GAP_M = 0.05;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** Whether a standing body ball with its feet at `feet` touches no solid collider but `self`'s. */
export function isStandingSpotFree(
  world: RAPIER.World,
  self: RapierRigidBody | null,
  charRadius: number,
  feet: Vec3,
): boolean {
  const centre = { x: feet.x, y: feet.y + charRadius + FLOOR_GAP_M, z: feet.z };
  const hit = world.intersectionWithShape(
    centre,
    IDENTITY,
    new RAPIER.Ball(charRadius),
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    undefined,
    self ?? undefined,
  );
  return hit === null;
}
