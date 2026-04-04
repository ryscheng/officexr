import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export type MotionPermission = 'unavailable' | 'prompt' | 'granted' | 'denied';

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
 * absent).  Both APIs use the same convention: 0 = portrait, 90 = landscape-
 * left, 270 (or -90) = landscape-right.
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
 * Handles device orientation (gyroscope) controls for a Three.js camera.
 * Abstracts capability detection, iOS permission prompting, and the
 * deviceorientation event listener so both RoomScene and UserLobby
 * can share the same motion-look behaviour.
 */
export function useMotionControls({ cameraRef, rendererRef }: UseMotionControlsOptions) {
  const [motionPermission, setMotionPermission] = useState<MotionPermission>('unavailable');
  const motionActiveRef = useRef(false);
  const recalibrateMotionRef = useRef<(() => void) | null>(null);

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

    // ── State captured on the first (or post-recalibrate) event ─────────────
    // Anchoring to the camera's current orientation means enabling motion never
    // snaps the view to a direction determined by compass / gravity alone.

    let prevAlpha: number | null = null;       // alpha from previous frame (incremental yaw)
    let accYaw: number | null = null;          // accumulated camera yaw (radians)
    let devicePitchOffset: number | null = null; // device rawPitch at anchor time
    let cameraPitchAtStart: number | null = null; // camera pitch (x rotation) at anchor time

    const recalibrate = () => {
      prevAlpha = null;
      accYaw = null;
      devicePitchOffset = null;
      cameraPitchAtStart = null;
    };
    recalibrateMotionRef.current = recalibrate;

    const handler = (event: DeviceOrientationEvent) => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!camera || !renderer) return;
      // Skip when WebXR is presenting (RoomScene) — check defensively
      if ((renderer as any).xr?.isPresenting) return;
      // Skip when mouse pointer lock is active
      if (document.pointerLockElement === renderer.domElement) return;
      if (event.alpha === null) return;

      const alpha = event.alpha;
      const beta  = event.beta  ?? 90;
      const gamma = event.gamma ?? 0;

      // ── Screen-orientation-aware pitch ────────────────────────────────────
      // Use getScreenAngle() which falls back to window.orientation for iOS <
      // 16.4 where screen.orientation is undefined.  Without the fallback the
      // portrait formula (beta - 90) is always used, meaning that on a
      // landscape iPad the user's natural up/down tilt moves gamma (ignored
      // for pitch) rather than beta, making pitch completely unresponsive.
      const screenAngle = getScreenAngle();
      let rawPitch: number; // degrees; 0 = neutral upright, positive = tilting top toward user
      if (screenAngle === 90 || screenAngle === -270) {
        rawPitch = gamma;   // landscape-left
      } else if (screenAngle === 270 || screenAngle === -90) {
        rawPitch = -gamma;  // landscape-right
      } else {
        rawPitch = beta - 90; // portrait: 0° when held upright
      }

      // ── Anchor on first event (or after recalibrate) ──────────────────────
      if (prevAlpha === null) {
        prevAlpha = alpha;
        devicePitchOffset = rawPitch;
        cameraPitchAtStart = camera.rotation.x;
        accYaw = camera.rotation.y;
        return; // skip this frame; use clean offsets from the next one
      }

      // ── Incremental yaw with gimbal-lock dampening ─────────────────────────
      // Computing yaw from a fixed alphaOffset means that when the device
      // approaches flat (|rawPitch| → 90°) the compass alpha reading becomes
      // unreliable and can jump by hundreds of degrees, snapping the view to a
      // dark/empty direction.  Instead, accumulate frame-to-frame alpha deltas
      // and scale them by cos(rawPitch) so yaw sensitivity fades smoothly to
      // zero as the device flattens — exactly where alpha is meaningless.
      let deltaAlpha = alpha - prevAlpha;
      if (deltaAlpha >  180) deltaAlpha -= 360;
      if (deltaAlpha < -180) deltaAlpha += 360;
      prevAlpha = alpha;

      const yawDamping = Math.cos(THREE.MathUtils.degToRad(rawPitch));
      accYaw = (accYaw ?? camera.rotation.y) + THREE.MathUtils.degToRad(deltaAlpha) * yawDamping;

      // ── Pitch from device tilt, anchored to camera start ──────────────────
      const pitch = (cameraPitchAtStart ?? 0) +
        THREE.MathUtils.degToRad(rawPitch - (devicePitchOffset ?? 0));

      // Clamp to ±85° — prevents looking at pure dark sky/floor at the extremes
      camera.rotation.set(
        Math.max(-Math.PI * 85 / 180, Math.min(Math.PI * 85 / 180, pitch)),
        accYaw,
        0,
        'YXZ',
      );
    };

    window.addEventListener('deviceorientation', handler);
    return () => {
      window.removeEventListener('deviceorientation', handler);
      recalibrateMotionRef.current = null;
    };
  }, [motionPermission, cameraRef, rendererRef]);

  const handleRequestMotionPermission = () => {
    (DeviceOrientationEvent as any)
      .requestPermission()
      .then((state: string) => setMotionPermission(state === 'granted' ? 'granted' : 'denied'))
      .catch(() => setMotionPermission('denied'));
  };

  // Let users switch back to mouse-look at any time
  const disableMotion = () => setMotionPermission('unavailable');

  return {
    motionPermission,
    motionActiveRef,
    recalibrateMotionRef,
    handleRequestMotionPermission,
    disableMotion,
  };
}
