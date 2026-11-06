import RAPIER from '@dimforge/rapier3d-compat';
import type { RapierRigidBody } from '@react-three/rapier';
import type { PlayerId, Store, Vec3 } from '@officexr/sdk';

/** What the frame loop needs from the seating controller. */
export interface SeatingSource {
  /** Sits on the seat the player is touching, if any. */
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

/** Sits on the frame E goes down; returns whether E is held, for the next frame's call. */
export function sitOnPress(keys: ReadonlySet<string>, wasDown: boolean, seating: SeatingSource | undefined): boolean {
  const down = keys.has('e');
  if (down && !wasDown) {
    seating?.sit();
  }
  return down;
}

/**
 * One frame of a seated self player, in place of the character controller and
 * gravity: stands up on `wantsToMove`, then pins `body` to the stored position.
 */
export function stepSeated(
  store: Store,
  selfId: PlayerId,
  body: RapierRigidBody,
  seating: SeatingSource | undefined,
  wantsToMove: boolean,
): void {
  if (wantsToMove) {
    seating?.stand();
  }
  const pos = store.getState().players[selfId]?.pos;
  if (pos) {
    body.setNextKinematicTranslation(pos);
  }
}
