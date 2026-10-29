import type { Vec3 } from '@officexr/sdk';
import { feetPosition } from '../physics/rules.ts';
import { CHAR_HEIGHT_M, EYE_HEIGHT, type CameraMode } from './config.ts';

export const PITCH_MIN = -1.3;
export const PITCH_MAX = 1.3;
export const MOUSE_SENSITIVITY = 0.0025;

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;

const FIXED_ELEVATION_MIN = (10 * Math.PI) / 180;
const FIXED_ELEVATION_MAX = (85 * Math.PI) / 180;
const FOV_MIN_DEG = 30;
const FOV_MAX_DEG = 100;
// Same factor as `THREE.MathUtils.degToRad`, so the fixed leash maths stays
// bit-identical without importing three.
export const DEG2RAD = Math.PI / 180;

/**
 * Per-user view state that stays local to the client (never part of
 * `WorldConstants`). In fixed mode the offsets orbit the camera around its
 * reference point: a positive azimuth offset turns the view to the right and a
 * positive pitch offset raises the camera.
 */
export interface ViewOffsets {
  fixedAzimuthOffsetRad: number;
  fixedPitchOffsetRad: number;
  /** Pinch and wheel zoom, 1 = no zoom. */
  zoom: number;
}

export interface LookRefs {
  yawRef: { current: number };
  pitchRef: { current: number };
  viewOffsetsRef: { current: ViewOffsets };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Modes whose yaw/pitch are mouse- and touch-driven. */
export function isYawPitchMode(mode: CameraMode): boolean {
  return mode === 'first-person' || mode === 'third-person';
}

export function isLookMode(mode: CameraMode): boolean {
  return isYawPitchMode(mode) || mode === 'fixed';
}

/**
 * Turns the view by `dYaw`/`dPitch` radians (positive = counter-clockwise yaw,
 * look up), the sign convention of mouse look. Modes without look input are
 * ignored. Fixed mode's elevation offset is clamped by `fixedLeash`, which
 * knows the base pitch.
 */
export function applyLookDelta(mode: CameraMode, dYaw: number, dPitch: number, refs: LookRefs): void {
  if (isYawPitchMode(mode)) {
    refs.yawRef.current += dYaw;
    refs.pitchRef.current = clamp(refs.pitchRef.current + dPitch, PITCH_MIN, PITCH_MAX);
  } else if (mode === 'fixed') {
    const offsets = refs.viewOffsetsRef.current;
    offsets.fixedAzimuthOffsetRad -= dYaw;
    offsets.fixedPitchOffsetRad -= dPitch;
  }
}

export function applyZoom(factor: number, offsets: ViewOffsets): void {
  offsets.zoom = clamp(offsets.zoom * factor, ZOOM_MIN, ZOOM_MAX);
}

export function pinchFactor(prevDistance: number, nextDistance: number): number {
  return prevDistance > 0 ? nextDistance / prevDistance : 1;
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_PX = 33;
const WHEEL_PAGE_PX = 800;
/** One 100px notch of a typical mouse wheel is a ~10% zoom step. */
const WHEEL_ZOOM_PER_PX = 0.001;
/** A trackpad pinch arrives as ctrl+wheel with small deltas; this tracks the fingers roughly 1:1. */
const PINCH_WHEEL_ZOOM_PER_PX = 0.01;

/**
 * Zoom factor for a wheel event: scrolling up (negative `deltaY`) zooms in and
 * the step is proportional to the scrolled distance, with line and page deltas
 * converted to pixels. `ctrlKey` marks a trackpad pinch.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey = false): number {
  const px =
    deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PX : deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGE_PX : 1;
  return Math.exp(-deltaY * px * (ctrlKey ? PINCH_WHEEL_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX));
}

/**
 * Field of view for a pinch zoom, interpolated geometrically so every zoom in
 * [ZOOM_MIN, ZOOM_MAX] maps to a distinct fov: `baseFovDeg` at zoom 1, 100° at
 * ZOOM_MIN and 30° at ZOOM_MAX.
 */
export function zoomedFov(baseFovDeg: number, zoom: number): number {
  const [limitDeg, zoomLimit] = zoom < 1 ? [FOV_MAX_DEG, ZOOM_MIN] : [FOV_MIN_DEG, ZOOM_MAX];
  return baseFovDeg * (limitDeg / baseFovDeg) ** (Math.log(zoom) / Math.log(zoomLimit));
}

interface FixedLeashParams {
  height: number;
  maxOnScreenFrac: number;
  minOnScreenFrac: number;
  lateralFrac: number;
  fov: number;
  /** Pins the XZ distance and collapses the leash (see `CameraRig`). */
  distanceM?: number;
}

/**
 * Fixed-camera pose limits. The leash is derived at the base pitch: the camera sits `height` above the
 * reference and keeps its XZ distance within [minDistance, maxDistance] (and
 * ±maxLateral sideways), sized so the character occupies between
 * `maxOnScreenFrac` and `minOnScreenFrac` of the screen:
 *   distance3D = charHeight / (2 · frac · tan(fov/2)), projected to XZ using
 * the camera's height above the character's centre.
 *
 * The pitch offset then orbits that pose about the reference: the height scales
 * by sin(elevation)/sin(base) and the XZ distances (and pinned `distanceM`) by
 * cos(elevation)/cos(base), which keeps the character on the look axis; the
 * elevation stays within 10°–85° (widened to include the base). Zoom divides
 * the whole camera→reference offset. With zero offsets and zoom 1 the result
 * is the unrotated pose, bit for bit.
 *
 * `pitchOffsetRad` is the offset actually in effect, for the caller to write
 * back so a drag past the limit doesn't wind up.
 */
export function fixedLeash(basePitchRad: number, fixed: FixedLeashParams, offsets: ViewOffsets) {
  const baseElevation = -basePitchRad;
  const pitchOffsetRad =
    baseElevation > 0
      ? clamp(
          offsets.fixedPitchOffsetRad,
          Math.min(FIXED_ELEVATION_MIN, baseElevation) - baseElevation,
          Math.max(FIXED_ELEVATION_MAX, baseElevation) - baseElevation,
        )
      : 0;
  const elevation = baseElevation + pitchOffsetRad;
  const heightScale = pitchOffsetRad === 0 ? 1 : Math.sin(elevation) / Math.sin(baseElevation);
  const distanceScale = pitchOffsetRad === 0 ? 1 : Math.cos(elevation) / Math.cos(baseElevation);

  const tanHalfFov = Math.tan((fixed.fov * DEG2RAD) / 2);
  const heightOffset = Math.max(0, fixed.height - CHAR_HEIGHT_M / 2);
  const safeMaxFrac = Math.max(0.005, fixed.maxOnScreenFrac);
  const safeMinFrac = Math.max(0.001, fixed.minOnScreenFrac);
  const dNear3D = CHAR_HEIGHT_M / (2 * safeMaxFrac * tanHalfFov);
  const dFar3D = CHAR_HEIGHT_M / (2 * safeMinFrac * tanHalfFov);

  // When `heightOffset >= dNear3D` the requested screen fraction is
  // geometrically impossible at this height, so the XZ distance falls back to
  // one that keeps the character along the look direction; clamping to ~1 m
  // instead would put it ~87° below the look axis, far outside the FOV.
  const tanPitch = Math.tan(Math.abs(basePitchRad));
  const pitchAlignedXZ = tanPitch > 0.01 ? heightOffset / tanPitch : heightOffset;

  const directXZ = fixed.distanceM === undefined ? undefined : fixed.distanceM * distanceScale;
  const minXZ =
    directXZ ??
    (dNear3D > heightOffset
      ? Math.sqrt(dNear3D * dNear3D - heightOffset * heightOffset)
      : pitchAlignedXZ * 0.6) * distanceScale;
  const maxXZ =
    directXZ ??
    (dFar3D > heightOffset
      ? Math.sqrt(dFar3D * dFar3D - heightOffset * heightOffset)
      : pitchAlignedXZ * 1.6) * distanceScale;
  const minDistance = Math.max(0.1, minXZ);
  const maxDistance = directXZ === undefined ? Math.max(minDistance + 0.5, maxXZ) : minDistance;

  const { zoom } = offsets;
  const maxLeash = maxDistance / zoom;
  return {
    pitchOffsetRad,
    pitchRad: basePitchRad - pitchOffsetRad,
    height: (fixed.height * heightScale) / zoom,
    minDistance: minDistance / zoom,
    maxDistance: maxLeash,
    maxLateral: directXZ === undefined ? fixed.lateralFrac * maxLeash * tanHalfFov : 0,
  };
}

/**
 * Yaw of the fixed camera for camera-relative WASD. The camera sits at
 * `+sin(az), -cos(az)` from the reference, so turning the view right (a
 * positive azimuth offset) lowers the yaw.
 */
export function fixedMovementYaw(
  azimuthDeg: number,
  azimuthOffsetRad: number,
  movementYawOffsetDeg: number,
): number {
  return (
    Math.PI -
    (azimuthDeg * Math.PI) / 180 -
    azimuthOffsetRad +
    (movementYawOffsetDeg * Math.PI) / 180
  );
}

/** Yaw (forward = `-sin, -cos`; positive turns counter-clockwise from above) of a look direction, ignoring its pitch. */
export function yawFromDirection(dir: { x: number; z: number }): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** Wraps an angle in radians into (-π, π]. */
export function wrapAngle(rad: number): number {
  const a = rad % (2 * Math.PI);
  return a <= -Math.PI ? a + 2 * Math.PI : a > Math.PI ? a - 2 * Math.PI : a;
}

/** Where a character's eyes are, from its store position (the body root). */
export function eyePosition(pos: Vec3, charRadius: number): Vec3 {
  const feet = feetPosition(pos, charRadius);
  return { x: feet.x, y: feet.y + EYE_HEIGHT, z: feet.z };
}

/**
 * Camera position `r` from `centre`, behind the look direction of `yaw`, for a
 * camera aimed at `centre`. A negative (look-down) pitch raises the camera
 * above the centre, so it looks down the same way first person does.
 */
export function orbitPosition(centre: Vec3, yaw: number, pitch: number, r: number): Vec3 {
  const cosP = Math.cos(pitch);
  return {
    x: centre.x + Math.sin(yaw) * cosP * r,
    y: centre.y + Math.sin(-pitch) * r,
    z: centre.z + Math.cos(yaw) * cosP * r,
  };
}
