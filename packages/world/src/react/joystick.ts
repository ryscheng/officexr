/** Analog walking intent: `x` is strafe (right +), `z` is forward (+), within the unit circle. */
export type MoveInput = { x: number; z: number };

export const NO_MOVE: MoveInput = { x: 0, z: 0 };

/** Deflection at or above this runs, like holding Shift. */
export const RUN_DEFLECTION = 0.9;

export const JOYSTICK_DEAD_ZONE = 0.15;

/**
 * Turns a pointer offset from the joystick centre (screen px, y down) into a
 * move vector: scaled by `radius`, clamped to the unit circle, zero inside
 * `deadZone`.
 */
export function joystickVector(dx: number, dy: number, radius: number, deadZone: number): MoveInput {
  const magnitude = Math.hypot(dx, dy) / radius;
  if (magnitude < deadZone) {
    return NO_MOVE;
  }
  const scale = Math.min(1, 1 / magnitude);
  return { x: (dx / radius) * scale, z: (-dy / radius) * scale };
}
