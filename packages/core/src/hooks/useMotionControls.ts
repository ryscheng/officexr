import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export type MotionPermission = 'unavailable' | 'prompt' | 'granted' | 'denied';

export interface MotionDebug {
  alpha: number; beta: number; gamma: number;
  screenAngle: number; naturalLandscape: boolean;
  rawPitch: number; deltaPitch: number; deltaAlpha: number;
}

interface UseMotionControlsOptions {
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
}

/**
 * Returns the current screen rotation angle in degrees.
 *
 * Prefers the standardised ScreenOrientation API (screen.orientation.angle)
 * and falls back to the legacy window.orientation property that iOS Safari
 * has always supported (needed for iOS < 16.4 where ScreenOrientation is
 * absent).
 */
function getScreenAngle(): number {
  if (typeof window === 'undefined') return 0;
  const so = (window.screen as any)?.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const wo = (window as any).orientation;
  if (typeof wo === 'number') return wo;
  return 0;
}

/**
 * Determines whether the device's natural (factory) orientation is landscape.
 *
 * screen.orientation.angle is measured relative to the natural orientation.
 * If angle=0 but the viewport is landscape, natural orientation must be landscape
 * (typical of iPads). If angle=0 and viewport is portrait, natural = portrait
 * (typical of iPhones).  Works across all iOS versions.
 *
 * Called once per calibration (when screen angle is first locked) so it uses
 * the current viewport size which reflects the actual device orientation.
 */
function detectNaturalLandscape(lockedScreenAngle: number): boolean {
  if (typeof window === 'undefined') return false;
  const landscapeViewport = window.innerWidth > window.innerHeight;
  // When angle=0 the viewport IS in the natural orientation.
  // When angle=90/270 the viewport has been rotated, so invert the check.
  const isRotated = lockedScreenAngle === 90 || lockedScreenAngle === 270 ||
                    lockedScreenAngle === -90 || lockedScreenAngle === -270;
  return isRotated ? !landscapeViewport : landscapeViewport;
}

/**
 * Converts device sensor axes (alpha/beta/gamma) into a scalar "raw pitch"
 * value (degrees) that DECREASES when tilting the device's top away from the
 * user (i.e. when looking up in the virtual world), regardless of screen or
 * natural orientation.  The accumulator negates this so that looking up maps
 * to an increase in camera.rotation.x (Three.js 'YXZ': positive x = look up).
 *
 * Two device families have different natural orientations:
 *
 *   Natural portrait  (iPhone): the pitch axis at angle=0 is beta (tilting
 *     top away → beta decreases → rawPitch = beta−90 decreases) ✓
 *
 *   Natural landscape (iPad):   in landscape the pitch axis is gamma (tilting
 *     top away → gamma decreases → rawPitch decreases) ✓.  In portrait the
 *     short edge is horizontal so the pitch axis shifts to beta (tilting top
 *     away → beta decreases → rawPitch decreases) ✓
 */
function calcRawPitch(
  beta: number,
  gamma: number,
  screenAngle: number,
  naturalLandscape: boolean,
): number {
  if (naturalLandscape) {
    // iPad portrait (angle 90/270): the device's short edge (X-axis) is now
    // horizontal, so pitch tilts rotate around it and change beta.  gamma stays
    // ~0 and only responds to left-right tilt, making it unusable for pitch.
    // The two portrait orientations mirror each other, so the sign flips.
    if (screenAngle === 90  || screenAngle === -270) return beta;
    if (screenAngle === 270 || screenAngle === -90)  return -beta;
    // iPad landscape (angle 0/180): the long edge is horizontal and pitch
    // tilts change gamma.
    return gamma;
  } else {
    // iPhone-style: pitch axis is beta in portrait, gamma in landscape.
    if (screenAngle === 90 || screenAngle === -270) return gamma;
    if (screenAngle === 270 || screenAngle === -90) return -gamma;
    return beta - 90; // portrait: 0° when held upright, decreases when tilting up
  }
}

/**
 * Handles device orientation (gyroscope) controls for a Three.js camera.
 * Abstracts capability detection, iOS permission prompting, and the
 * deviceorientation event listener so both RoomScene and UserLobby
 * can share the same motion-look behaviour.
 */
export function useMotionControls({ cameraRef, rendererRef }: UseMotionControlsOptions) {
  const [motionPermission, setMotionPermission] = useState<MotionPermission>('unavailable');
  const motionActiveRef = useRef(false);
  const recalibrateMotionRef = useRef<(() => void) | null>(null);
  const motionDebugRef = useRef<MotionDebug | null>(null);

  // Detect device orientation capability once on mount.
  //
  // Problem: DeviceOrientationEvent is defined in all modern browsers, including
  // desktop Chrome/Firefox, but desktops never fire real events (no accelerometer).
  // Checking only for the constructor's existence therefore incorrectly marks desktop
  // as "motion granted", blocking the pointer-lock mouse-look path.
  //
  // Strategy:
  //   iOS 13+  → requestPermission() exists → set 'prompt' (needs user gesture)
  //   Others   → listen for a first real event (non-null alpha/beta/gamma) within
  //              500 ms.  If one arrives the device has a live accelerometer and we
  //              set 'granted'.  If the timeout expires first we leave the state as
  //              'unavailable' so desktop mouse-look remains active.
  useEffect(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return;

    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      setMotionPermission('prompt'); // iOS 13+ — needs explicit user gesture
      return;
    }

    // Probe: wait up to 500 ms for the first real orientation event.
    const onFirstEvent = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
        clearTimeout(timeout);
        window.removeEventListener('deviceorientation', onFirstEvent);
        setMotionPermission('granted');
      }
    };

    const timeout = setTimeout(() => {
      window.removeEventListener('deviceorientation', onFirstEvent);
      // State stays 'unavailable' — desktop or device with no live sensor
    }, 500);

    window.addEventListener('deviceorientation', onFirstEvent);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('deviceorientation', onFirstEvent);
    };
  }, []);

  // Keep motionActiveRef in sync so Three.js event handlers can read it
  useEffect(() => {
    motionActiveRef.current = motionPermission === 'granted';
  }, [motionPermission]);

  // Attach deviceorientation listener whenever permission is granted
  useEffect(() => {
    if (motionPermission !== 'granted') return;

    // Both yaw and pitch are driven incrementally (frame-to-frame deltas).
    // This avoids Euler singularities that absolute formulas suffer from.
    //
    // Yaw:   device rotates CW (right) → alpha DECREASES → deltaAlpha < 0
    //        → accYaw decreases → rotation.y < 0 → looking RIGHT ✓
    // Pitch: tilting top away (looking up) → rawPitch DECREASES → deltaPitch < 0
    //        → accPitch INCREASES (negated) → rotation.x > 0 → looking UP ✓
    //
    // Glitch protection: skip frames where the per-axis delta exceeds
    // GLITCH_THRESHOLD_DEG. Sensor singularity spikes are 90-180°; normal
    // hand movement at realistic sensor rates is under 30°/event.

    const GLITCH_THRESHOLD_DEG = 30;

    let prevAlpha: number | null = null;
    let prevRawPitch: number | null = null;
    let accYaw: number | null = null;
    let accPitch: number | null = null;
    let lockedScreenAngle: number | null = null;
    let lockedNaturalLandscape = false;

    const recalibrate = () => {
      prevAlpha = null;
      prevRawPitch = null;
      accYaw = null;
      accPitch = null;
      lockedScreenAngle = null;
    };
    recalibrateMotionRef.current = recalibrate;

    const handler = (event: DeviceOrientationEvent) => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!camera || !renderer) return;
      if ((renderer as any).xr?.isPresenting) return;
      if (document.pointerLockElement === renderer.domElement) return;
      if (event.alpha === null) return;

      const alpha = event.alpha;
      const beta  = event.beta  ?? 90;
      const gamma = event.gamma ?? 0;

      // Lock screen angle + natural-landscape flag on first event so a
      // mid-session screen auto-rotate doesn't switch the pitch formula.
      if (lockedScreenAngle === null) {
        lockedScreenAngle = getScreenAngle();
        lockedNaturalLandscape = detectNaturalLandscape(lockedScreenAngle);
      }
      const rawPitch = calcRawPitch(beta, gamma, lockedScreenAngle, lockedNaturalLandscape);

      // First event: anchor accumulators to the camera's current orientation
      // so enabling motion never snaps the view.
      if (prevAlpha === null) {
        prevAlpha    = alpha;
        prevRawPitch = rawPitch;
        accYaw       = camera.rotation.y;
        accPitch     = camera.rotation.x;
        return;
      }

      // ── Yaw ────────────────────────────────────────────────────────────────
      let deltaAlpha = alpha - prevAlpha;
      if (deltaAlpha >  180) deltaAlpha -= 360;
      if (deltaAlpha < -180) deltaAlpha += 360;
      prevAlpha = alpha;

      if (Math.abs(deltaAlpha) <= GLITCH_THRESHOLD_DEG) {
        accYaw = (accYaw ?? camera.rotation.y) + THREE.MathUtils.degToRad(deltaAlpha);
      }

      // ── Pitch (negated: rawPitch decreases when tilting up) ─────────────────
      const deltaPitch = rawPitch - (prevRawPitch ?? rawPitch);
      prevRawPitch = rawPitch;

      if (Math.abs(deltaPitch) <= GLITCH_THRESHOLD_DEG) {
        accPitch = Math.max(
          -Math.PI * 85 / 180,
          Math.min(
            Math.PI * 85 / 180,
            (accPitch ?? camera.rotation.x) - THREE.MathUtils.degToRad(deltaPitch),
          ),
        );
      }

      camera.rotation.set(accPitch ?? camera.rotation.x, accYaw ?? camera.rotation.y, 0, 'YXZ');

      motionDebugRef.current = {
        alpha, beta, gamma,
        screenAngle: lockedScreenAngle,
        naturalLandscape: lockedNaturalLandscape,
        rawPitch, deltaPitch, deltaAlpha,
      };
    };

    window.addEventListener('deviceorientation', handler);
    window.addEventListener('orientationchange', recalibrate);
    return () => {
      window.removeEventListener('deviceorientation', handler);
      window.removeEventListener('orientationchange', recalibrate);
      recalibrateMotionRef.current = null;
    };
  }, [motionPermission, cameraRef, rendererRef]);

  const handleRequestMotionPermission = () => {
    (DeviceOrientationEvent as any)
      .requestPermission()
      .then((state: string) => setMotionPermission(state === 'granted' ? 'granted' : 'denied'))
      .catch(() => setMotionPermission('denied'));
  };

  const disableMotion = () => setMotionPermission('unavailable');

  return {
    motionPermission,
    motionActiveRef,
    recalibrateMotionRef,
    motionDebugRef,
    handleRequestMotionPermission,
    disableMotion,
  };
}
