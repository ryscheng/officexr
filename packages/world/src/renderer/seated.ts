import { useEffect, type RefObject } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { liveRigidBody } from './liveRigidBody.ts';
import type { PlayerId, Store, Vec3 } from '@officexr/sdk';
import { STEP_UP_MAX_HEIGHT } from '../physics/step-up.ts';

/** What the frame loop needs from the seating controller. */
export interface SeatingSource {
  /** Sits on the seat the player is touching, if any. */
  sit(): void;
  stand(): void;
  /** Installs the test `stand` uses for a collider-free spot; returns its removal. */
  setStandingCheck(isFree: (feet: Vec3) => boolean): () => void;
}

/** Lifts the probe off the ground so the ground itself doesn't count as an obstacle. */
const FLOOR_GAP_M = 0.05;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const DOWN = { x: 0, y: -1, z: 0 };

/**
 * Whether a standing body ball at `feet` touches no solid collider but `self`'s.
 * The ball stands on whatever ground lies within a step of `feet`, since a chair's
 * footprint can start below a floor slab's top: probing from `feet` itself would
 * bury the ball in the floor and call every spot blocked.
 */
export function isStandingSpotFree(
  world: RAPIER.World,
  self: RapierRigidBody | null,
  charRadius: number,
  feet: Vec3,
): boolean {
  const ground = groundHeight(world, self, feet) ?? feet.y;
  const centre = { x: feet.x, y: ground + charRadius + FLOOR_GAP_M, z: feet.z };
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

/** The top of the first solid surface within a climbable step above or below `feet`, if any. */
function groundHeight(world: RAPIER.World, self: RapierRigidBody | null, feet: Vec3): number | null {
  // ponytail: an obstacle no taller than a step reads as ground, so a spot on a low table counts as free.
  const from = { x: feet.x, y: feet.y + STEP_UP_MAX_HEIGHT, z: feet.z };
  const hit = world.castRay(
    new RAPIER.Ray(from, DOWN),
    2 * STEP_UP_MAX_HEIGHT,
    true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    undefined,
    self ?? undefined,
  );
  return hit === null ? null : from.y - hit.timeOfImpact;
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

/** Installs `seating`'s standing check against the `<Physics>` world it is mounted in. */
export function StandingCheck({
  store,
  seating,
  selfBodyRef,
}: {
  store: Store;
  seating?: SeatingSource;
  selfBodyRef: RefObject<RapierRigidBody | null>;
}): null {
  const { world } = useRapier();
  useEffect(
    () =>
      seating?.setStandingCheck((feet) =>
        isStandingSpotFree(world, liveRigidBody(selfBodyRef.current), store.getState().worldSettings.charRadius, feet),
      ),
    [seating, world, store, selfBodyRef],
  );
  return null;
}
