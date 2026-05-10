/**
 * World/scene defaults for the debug-app.
 *
 * Tweak `WORLD.gridSize` to change the floor footprint. The renderer rebuilds
 * its instanced cube buffers when this changes.
 */
export const CUBE_SIZE = 2; // KayKit BlockBits cubes are 2×2×2 units

export const WORLD = {
  /** Floor side length in cubes (square grid). */
  gridSize: 50,
  /** Number of stone layers placed beneath the surface. */
  stoneLayers: 2,
};

export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.6;

/** Default fixed-camera tweakables, exposed via the debug panel (Leva). */
export const FIXED_CAMERA_DEFAULTS = {
  azimuthDeg: 202.5, // SSW heading from north (0 = N, 90 = E, 180 = S, 270 = W)
  elevationDeg: 35, // angle above horizon — slightly isometric
  distance: 80,
  fov: 50,
};

export const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;
export type CharacterName = (typeof CHARACTERS)[number];

export type CameraMode = 'first-person' | 'third-person' | 'fixed';
export const CAMERA_MODES: readonly CameraMode[] = [
  'first-person',
  'third-person',
  'fixed',
];
