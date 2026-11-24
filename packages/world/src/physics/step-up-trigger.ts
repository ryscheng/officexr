/**
 * When a step-up is worth probing for, shared by the local player
 * (SceneFrame) and bots (BotPhysicsWorld).
 *
 * Pushing straight into a riser blocks the character, which is the
 * classic trigger. Pushing into it at an angle doesn't: the controller
 * slides along the face and keeps cos²θ of the intent, so a 45° approach
 * reads as half-progress and never looks blocked. The contact itself is
 * the better signal: a near-vertical face the intent pushes into.
 *
 * Low furniture approached at up to 60° is climbed too; it is already
 * climbable head-on.
 *
 * Risers lower than about 0.28 m (0.7 × the 0.4 m ball radius) touch the
 * ball with their top edge, low on its curve, so the contact normal tilts
 * up past `MAX_FACE_NORMAL_Y`; at an angle they still rely on the
 * blocked trigger.
 */

import type { Vec3 } from '@officexr/sdk';

/** Largest |n.y| of a contact normal that still counts as a wall or
 * riser face rather than floor, ceiling or slope. */
const MAX_FACE_NORMAL_Y = 0.3;

/** cos 60°: the intent must point within 60° of straight into the face.
 * A shallower graze keeps sliding along it. */
export const MIN_FACE_ALIGNMENT = 0.5;

/** A wall or riser face the character pushes into. */
export interface FaceAhead {
  /** Outward horizontal unit normal of the face. */
  normal: { x: number; z: number };
  /** Cosine between the intent and the direction straight into the face. */
  alignment: number;
}

/**
 * The near-vertical face among `contactNormals` (outward normals of the
 * world geometry the controller touched this frame, e.g. Rapier's
 * `computedCollision(i).normal1`) that the intent (dx, dz) pushes into
 * most squarely, if within 60°; otherwise null.
 */
export function faceAhead(
  contactNormals: Iterable<Vec3>,
  dx: number,
  dz: number,
): FaceAhead | null {
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    return null;
  }
  let best: FaceAhead | null = null;
  for (const n of contactNormals) {
    const horizontal = Math.hypot(n.x, n.z);
    if (Math.abs(n.y) > MAX_FACE_NORMAL_Y || horizontal < 1e-9) {
      continue;
    }
    const normal = { x: n.x / horizontal, z: n.z / horizontal };
    const alignment = -(dx * normal.x + dz * normal.z) / len;
    if (alignment >= MIN_FACE_ALIGNMENT && (!best || alignment > best.alignment)) {
      best = { normal, alignment };
    }
  }
  return best;
}

/** One frame's movement outcome, as the step-up trigger sees it. */
export interface StepUpFrame {
  /** This frame's horizontal move. */
  intent: { x: number; z: number };
  /** Whether the move was (nearly) fully blocked. */
  blocked: boolean;
  /** Outward normals of the world geometry (not characters) touched. */
  worldContactNormals: Iterable<Vec3>;
  /** Whether the move touched another character: a character is never
   * a step, and probing into one would climb onto its head. */
  touchingCharacter: boolean;
  grounded: boolean;
  /** Mid-jump or landing; a climb would take the air velocity's pace. */
  airborne: boolean;
  /** Integrated vertical velocity, m/s. */
  verticalVel: number;
}

/**
 * Whether to probe for a step-up this frame: a grounded, non-jumping,
 * non-rising character that is blocked or pushes into a face, with no
 * character contact. Returns the face to pass to the probe (null when
 * only blocked), or null when there is nothing to probe.
 */
export function stepUpTrigger(frame: StepUpFrame): { face: FaceAhead | null } | null {
  const { intent } = frame;
  if (
    (intent.x === 0 && intent.z === 0) ||
    frame.touchingCharacter ||
    !frame.grounded ||
    frame.airborne ||
    frame.verticalVel > 0
  ) {
    return null;
  }
  const face = faceAhead(frame.worldContactNormals, intent.x, intent.z);
  return frame.blocked || face ? { face } : null;
}
