import { NO_MOVE, type MoveInput } from '../renderer/moveIntent.ts';

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

export function floatingOrigin(point: { x: number; y: number }, zone: { width: number; height: number }, half: number) {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, half), Math.max(half, max - half));
  return { x: clamp(point.x, zone.width), y: clamp(point.y, zone.height) };
}
