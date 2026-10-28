import { DEG2RAD } from './lookControls.ts';

export interface MotionLookState {
  enabled: boolean;
  /** Changing this restores the view captured when motion look was enabled. */
  recenterKey: number;
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

export type DeviceReading = Pick<DeviceOrientationEvent, 'alpha' | 'beta' | 'gamma'>;

/** Direction of the device's back camera in world space, in degrees (positive yaw = left, positive pitch = up). */
export interface MotionPose {
  yawDeg: number;
  pitchDeg: number;
}

/** Sensor spikes near Euler singularities are 90-180°; real hand motion stays well under this per event. */
export const GLITCH_THRESHOLD_DEG = 30;

const PROBE_TIMEOUT_MS = 500;

/**
 * Where the back camera, `R(α,β,γ)·(0,0,−1)`, points. Rolling the device about
 * its screen normal leaves it unchanged, so portrait and landscape need no
 * special-casing. Null for a reading without an orientation, as desktop
 * browsers emit.
 */
export function toPose({ alpha, beta, gamma }: DeviceReading): MotionPose | null {
  if (alpha === null || beta === null || gamma === null) {
    return null;
  }
  const [a, b, g] = [alpha, beta, gamma].map((deg) => deg * DEG2RAD);
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  const west = Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g);
  const up = Math.min(1, Math.max(-1, -Math.cos(b) * Math.cos(g)));
  return { yawDeg: Math.atan2(west, north) / DEG2RAD, pitchDeg: Math.asin(up) / DEG2RAD };
}

const wrap180 = (deg: number) => (deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg);

const unlessGlitch = (deltaDeg: number) => (Math.abs(deltaDeg) <= GLITCH_THRESHOLD_DEG ? deltaDeg * DEG2RAD : 0);

/**
 * Look delta in radians, in `applyLookDelta`'s convention, between two
 * consecutive poses. An axis whose jump exceeds the glitch threshold
 * contributes nothing.
 */
export function lookDelta(prev: MotionPose, next: MotionPose): { dYaw: number; dPitch: number } {
  return {
    dYaw: unlessGlitch(wrap180(next.yawDeg - prev.yawDeg)),
    dPitch: unlessGlitch(next.pitchDeg - prev.pitchDeg),
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
    try {
      if ((await requestPermission.call(DeviceOrientationEvent)) !== 'granted') {
        return 'denied';
      }
    } catch {
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
      if (toPose(e)) {
        finish('granted');
      }
    };
    const timer = setTimeout(() => finish('unsupported'), PROBE_TIMEOUT_MS);
    window.addEventListener('deviceorientation', onReading);
  });
}
