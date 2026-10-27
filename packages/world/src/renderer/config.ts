/**
 * Renderer constants. Map Editor maps are the only source of visible
 * cubes; there is no longer a default-floor or playable-area concept
 * here — `<MapColliders>` drives physics from `state.worldObjects`.
 */
// 0.5 m grid — four voxels per KayKit 2×2×2 block (was 2 before v4 migration)
export const VOXEL_SIZE = 0.5;

/** @deprecated Use VOXEL_SIZE */
export const CUBE_SIZE = VOXEL_SIZE;

export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.6;

export { FIXED_CAMERA_DEFAULTS } from '@officexr/sdk';

/** Used by the screen-fraction → distance formula. */
export const CHAR_HEIGHT_M = 1.8;

// CHARACTERS lives in `../characters/registry.ts` now (it's the canonical
// model registry — studio's CharacterMode and the per-character config
// resolver both read it). Re-exported here so the renderer's existing
// imports keep working.
export { CHARACTERS, type CharacterName } from '../characters/registry.ts';

export type CameraMode =
  | 'first-person'
  | 'third-person'
  | 'fixed'
  | 'top-down'
  | 'free-fly';
export const CAMERA_MODES: readonly CameraMode[] = [
  'first-person',
  'third-person',
  'fixed',
  'top-down',
  'free-fly',
];

/** Defaults for the top-down editor camera (studio's Scene mode).
 * Extends the FIXED_CAMERA_DEFAULTS pattern: pitch is straight down,
 * altitude is high enough to see a 20×20 grid by default. */
export const TOP_DOWN_CAMERA_DEFAULTS = {
  pitchDeg: -89.9,
  azimuthDeg: 0,
  height: 60,
  fov: 45,
};

/** Free-fly camera defaults — starting pose for the Scenes editor.
 * Pitched down ~30° so the user starts looking at the build platform
 * from a comfortable elevated angle. */
export const FREE_FLY_DEFAULTS = {
  position: [0, 25, 25] as [number, number, number],
  yaw: 0,
  pitch: -0.7,
  fov: 60,
  /** WASD speed in metres/sec at base; Shift multiplies. */
  moveSpeed: 12,
  shiftMultiplier: 3,
  /** Mouse drag → radians; tuned to feel like a comfortable orbit. */
  rotateSensitivity: 0.005,
  /** Wheel delta → world units per notch. */
  dollySensitivity: 1.5,
};
