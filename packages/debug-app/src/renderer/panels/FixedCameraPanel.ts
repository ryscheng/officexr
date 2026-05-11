import { useControls } from 'leva';
import { FIXED_CAMERA_DEFAULTS } from '../config.ts';

export interface FixedCameraPanelValues {
  azimuthDeg: number;
  pitchDeg: number;
  height: number;
  maxOnScreenFrac: number;
  minOnScreenFrac: number;
  lateralFrac: number;
  fov: number;
  movementYawOffsetDeg: number;
}

/**
 * Leva "Fixed camera" panel. Local-only — these are renderer tweakables
 * that don't affect peers.
 */
export function useFixedCameraPanel(): FixedCameraPanelValues {
  return useControls(
    'Fixed camera',
    {
      azimuthDeg: {
        value: FIXED_CAMERA_DEFAULTS.azimuthDeg,
        min: 0,
        max: 360,
        step: 0.5,
        label: 'azimuth (°)',
      },
      pitchDeg: {
        value: FIXED_CAMERA_DEFAULTS.pitchDeg,
        min: -89,
        max: 89,
        step: 0.5,
        label: 'pitch (°)',
      },
      height: {
        value: FIXED_CAMERA_DEFAULTS.height,
        min: 0,
        max: 200,
        step: 0.5,
        label: 'height (Y)',
      },
      maxOnScreenFrac: {
        value: FIXED_CAMERA_DEFAULTS.maxOnScreenFrac,
        min: 0.05,
        max: 0.6,
        step: 0.005,
        label: 'near (screen %)',
      },
      minOnScreenFrac: {
        value: FIXED_CAMERA_DEFAULTS.minOnScreenFrac,
        min: 0.01,
        max: 0.3,
        step: 0.005,
        label: 'far (screen %)',
      },
      lateralFrac: {
        value: FIXED_CAMERA_DEFAULTS.lateralFrac,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'lateral (frac)',
      },
      fov: {
        value: FIXED_CAMERA_DEFAULTS.fov,
        min: 20,
        max: 110,
        step: 1,
      },
      movementYawOffsetDeg: {
        value: 0,
        min: -180,
        max: 180,
        step: 0.5,
        label: 'WASD offset (°)',
      },
    },
    { collapsed: false },
  );
}
