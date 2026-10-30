import type { CameraMode } from './config.ts';

const CLICK_MAX_TRAVEL_PX = 5;

interface ScreenPoint {
  x: number;
  y: number;
}

/** Modes without pointer lock, where the pointer is free to pick a spot. */
export function allowsFloorClick(mode: CameraMode): boolean {
  return mode === 'top-down' || mode === 'fixed';
}

/** A press and release that stayed put is a click; one that travelled was a drag. */
export function isClick(down: ScreenPoint, up: ScreenPoint): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_MAX_TRAVEL_PX;
}
