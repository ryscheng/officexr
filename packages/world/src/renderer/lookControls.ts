import type { CameraMode } from './config.ts';

export const PITCH_MIN = -1.3;
export const PITCH_MAX = 1.3;
export const MOUSE_SENSITIVITY = 0.0025;
export const TOUCH_SENSITIVITY = 0.005;

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;

const FIXED_ELEVATION_MIN = (10 * Math.PI) / 180;
const FIXED_ELEVATION_MAX = (85 * Math.PI) / 180;
const FOV_MIN_DEG = 30;
const FOV_MAX_DEG = 100;

/**
 * Per-user view state that stays local to the client (never part of
 * `WorldConstants`). In fixed mode the offsets orbit the camera around its
 * reference point: a positive azimuth offset turns the view to the right and a
 * positive pitch offset raises the camera.
 */
export interface ViewOffsets {
  fixedAzimuthOffsetRad: number;
  fixedPitchOffsetRad: number;
  /** Pinch zoom, 1 = no zoom. */
  zoom: number;
}

export interface LookRefs {
  yawRef: { current: number };
  pitchRef: { current: number };
  viewOffsetsRef: { current: ViewOffsets };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Turns the view by `dYaw`/`dPitch` radians (positive = counter-clockwise yaw,
 * look up), the sign convention of mouse look. Modes without look input are
 * ignored. Fixed mode's elevation offset is clamped by `fixedOrbit`, which
 * knows the base pitch.
 */
export function applyLookDelta(mode: CameraMode, dYaw: number, dPitch: number, refs: LookRefs): void {
  if (mode === 'first-person' || mode === 'third-person') {
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

/** Zoom factor for a pinch whose finger distance went from `prev` to `next`. */
export function pinchFactor(prevDistance: number, nextDistance: number): number {
  return prevDistance > 0 ? nextDistance / prevDistance : 1;
}

export function zoomedFov(baseFovDeg: number, zoom: number): number {
  return clamp(baseFovDeg / zoom, FOV_MIN_DEG, FOV_MAX_DEG);
}

/**
 * Fixed-mode orbit around the reference point. Rotates the camera→reference
 * offset to the elevation `-basePitchRad` plus the pitch offset, so the camera
 * height scales with the sine of the elevation and the camera keeps looking
 * down at the reference. With zero offsets it returns the inputs unchanged.
 * The elevation stays within 10°–85° (widened to include the base elevation),
 * and `pitchOffsetRad` is the offset actually in effect, to write back.
 */
export function fixedOrbit(basePitchRad: number, height: number, offsets: ViewOffsets) {
  const baseElevation = -basePitchRad;
  const pitchOffsetRad = clamp(
    offsets.fixedPitchOffsetRad,
    Math.min(FIXED_ELEVATION_MIN, baseElevation) - baseElevation,
    Math.max(FIXED_ELEVATION_MAX, baseElevation) - baseElevation,
  );
  const orbitHeight =
    pitchOffsetRad === 0 || baseElevation <= 0
      ? height
      : (height * Math.sin(baseElevation + pitchOffsetRad)) / Math.sin(baseElevation);
  return {
    azimuthOffsetRad: offsets.fixedAzimuthOffsetRad,
    pitchOffsetRad,
    pitchRad: basePitchRad - pitchOffsetRad,
    orbitHeight,
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
