import { fitTransform, screenToWorld, type ScreenPoint, type TopDownTransform, type XZ, type XZBounds } from './topDownGeometry.ts';

type Size = { width: number; height: number };

/** What the 2D view shows: `zoom` pixels per metre around `centre`, which tracks you while `following`. */
export interface CameraState {
  centre: XZ;
  zoom: number;
  following: boolean;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

/** About a desk and its neighbours across a laptop screen, close to Gather's default. */
export const DEFAULT_ZOOM = 48;
/** Close enough to read a desk's monitors. */
export const MAX_ZOOM = 140;
/** Each zoom button press or keypress. */
export const ZOOM_STEP = 1.25;
/** How quickly the camera catches up with you, per second; higher is snappier. */
const FOLLOW_RATE = 8;

export const INITIAL_CAMERA: CameraState = { centre: { x: 0, z: 0 }, zoom: DEFAULT_ZOOM, following: true };

/** Zoomed out as far as the whole map (or the default, if that is closer), in to `MAX_ZOOM`. */
export function zoomLimits(bounds: XZBounds | null, size: Size): ZoomLimits {
  const fit = bounds ? fitTransform(bounds, size).scale : DEFAULT_ZOOM;
  return { min: Math.min(fit, DEFAULT_ZOOM), max: MAX_ZOOM };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function cameraTransform(cam: CameraState, size: Size): TopDownTransform {
  return {
    scale: cam.zoom,
    offsetX: size.width / 2 - cam.centre.x * cam.zoom,
    offsetY: size.height / 2 - cam.centre.z * cam.zoom,
  };
}

/**
 * Multiplies the zoom by `factor` within `limits`. With an `anchor` the world point under
 * it stays put; without one (or while following) the zoom is about the centre, i.e. about you.
 */
export function zoomBy(cam: CameraState, factor: number, limits: ZoomLimits, size: Size, anchor?: ScreenPoint): CameraState {
  const zoom = clamp(cam.zoom * factor, limits.min, limits.max);
  if (!anchor || cam.following) {
    return { ...cam, zoom };
  }
  const world = screenToWorld(cameraTransform(cam, size), anchor);
  return {
    ...cam,
    zoom,
    centre: {
      x: world.x - (anchor.x - size.width / 2) / zoom,
      z: world.z - (anchor.y - size.height / 2) / zoom,
    },
  };
}

/** Drags the view by a screen delta; panning stops the camera following you. */
export function panBy(cam: CameraState, dx: number, dy: number): CameraState {
  return { ...cam, following: false, centre: { x: cam.centre.x - dx / cam.zoom, z: cam.centre.z - dy / cam.zoom } };
}

/** Eases the centre towards `target` while following; frame-rate independent. */
export function followStep(cam: CameraState, target: XZ, dtSec: number): CameraState {
  if (!cam.following) {
    return cam;
  }
  const k = 1 - Math.exp(-FOLLOW_RATE * dtSec);
  return {
    ...cam,
    centre: { x: cam.centre.x + (target.x - cam.centre.x) * k, z: cam.centre.z + (target.z - cam.centre.z) * k },
  };
}

/** Keeps the centre over the map, so a pan can't lose it off screen. */
export function clampToBounds(cam: CameraState, bounds: XZBounds | null): CameraState {
  if (!bounds) {
    return cam;
  }
  const x = clamp(cam.centre.x, bounds.min.x, bounds.max.x);
  const z = clamp(cam.centre.z, bounds.min.z, bounds.max.z);
  return x === cam.centre.x && z === cam.centre.z ? cam : { ...cam, centre: { x, z } };
}

/** The world rectangle on screen, for culling. */
export function visibleBounds(t: TopDownTransform, size: Size): XZBounds {
  return { min: screenToWorld(t, { x: 0, y: 0 }), max: screenToWorld(t, { x: size.width, y: size.height }) };
}
