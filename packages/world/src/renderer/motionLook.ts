import { DEG2RAD } from './lookControls.ts';

export interface MotionLookState {
  enabled: boolean;
  /** Changing this restores the view captured when motion look was enabled. */
  recenterKey: number;
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

export interface DeviceReading {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

/** Device attitude in degrees, in the frame of the screen angle it was read at. */
export interface MotionPose {
  yawDeg: number;
  pitchDeg: number;
  screenAngle: number;
}

/** Sensor spikes near Euler singularities are 90-180°; real hand motion stays well under this per event. */
export const GLITCH_THRESHOLD_DEG = 30;

const PROBE_TIMEOUT_MS = 500;

/** Screen rotation in degrees (0/90/180/270), falling back to iOS's legacy `window.orientation`. */
export function readScreenAngle(): number {
  const angle = window.screen?.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
  return ((angle % 360) + 360) % 360;
}

/**
 * Whether the device's factory orientation is landscape (iPads). The screen
 * angle is relative to that orientation, so a rotated screen inverts the
 * viewport check.
 */
export function isNaturalLandscape(screenAngle: number, landscapeViewport: boolean): boolean {
  return screenAngle === 90 || screenAngle === 270 ? !landscapeViewport : landscapeViewport;
}

/**
 * Pitch axis in degrees, decreasing as the top of the device tilts away
 * (looking up). Which sensor axis carries pitch depends on the screen angle
 * and the device's natural orientation.
 */
function rawPitch(beta: number, gamma: number, screenAngle: number, naturalLandscape: boolean): number {
  if (naturalLandscape) {
    if (screenAngle === 90) {
      return -beta;
    }
    if (screenAngle === 270) {
      return beta;
    }
    return gamma;
  }
  if (screenAngle === 90) {
    return gamma;
  }
  if (screenAngle === 270) {
    return -gamma;
  }
  return beta - 90;
}

/** Null for a reading without an orientation, as desktop browsers emit. */
export function toPose(reading: DeviceReading, screenAngle: number, naturalLandscape: boolean): MotionPose | null {
  if (reading.alpha === null) {
    return null;
  }
  return {
    yawDeg: reading.alpha,
    pitchDeg: rawPitch(reading.beta ?? 90, reading.gamma ?? 0, screenAngle, naturalLandscape),
    screenAngle,
  };
}

const wrap180 = (deg: number) => (deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg);

const unlessGlitch = (deltaDeg: number) => (Math.abs(deltaDeg) <= GLITCH_THRESHOLD_DEG ? deltaDeg * DEG2RAD : 0);

/**
 * Look delta in radians, in `applyLookDelta`'s convention, between two
 * consecutive poses. Turning the device left raises alpha, and tilting its top
 * away lowers the raw pitch. An axis whose jump exceeds the glitch threshold
 * contributes nothing, as does a change of screen angle, whose readings
 * aren't comparable.
 */
export function lookDelta(prev: MotionPose, next: MotionPose): { dYaw: number; dPitch: number } {
  if (prev.screenAngle !== next.screenAngle) {
    return { dYaw: 0, dPitch: 0 };
  }
  return {
    dYaw: unlessGlitch(wrap180(next.yawDeg - prev.yawDeg)),
    dPitch: unlessGlitch(prev.pitchDeg - next.pitchDeg),
  };
}

/**
 * Asks for motion access and checks the device really reports it. iOS needs
 * `requestPermission()` called synchronously inside a tap, so it is the first
 * thing this does. Desktop Chrome exposes `DeviceOrientationEvent` but never
 * fires it, hence the wait for a first reading.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceOrientationEvent === 'undefined') {
    return 'unsupported';
  }
  const { requestPermission } = DeviceOrientationEvent as { requestPermission?: () => Promise<string> };
  if (typeof requestPermission === 'function') {
    const state = await requestPermission.call(DeviceOrientationEvent).catch(() => 'denied');
    if (state !== 'granted') {
      return 'denied';
    }
  }
  return new Promise((resolve) => {
    const finish = (result: MotionPermission) => {
      clearTimeout(timer);
      window.removeEventListener('deviceorientation', onReading);
      resolve(result);
    };
    const onReading = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null) {
        finish('granted');
      }
    };
    const timer = setTimeout(() => finish('unsupported'), PROBE_TIMEOUT_MS);
    window.addEventListener('deviceorientation', onReading);
  });
}
