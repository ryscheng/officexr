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
 * Converts device sensor axes (alpha/beta/gamma) into a scalar "raw pitch"
 * value (degrees) whose sign convention matches Three.js camera pitch:
 *   0   = device held upright / neutral viewing angle
 *   neg = looking up (device top tilted away from user)
 *   pos = looking down (device top tilted toward user)
 *
 * The mapping depends on screen orientation because the physical axis that
 * controls "up/down gaze" rotates with the screen.
 */
function calcRawPitch(beta: number, gamma: number, screenAngle: number): number {
  if (screenAngle === 90 || screenAngle === -270) return gamma;   // landscape-left
  if (screenAngle === 270 || screenAngle === -90) return -gamma;  // landscape-right
  return beta - 90; // portrait: 0° when held upright
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

    // Both yaw and pitch are driven incrementally (frame-to-frame deltas) rather
    // than from a fixed offset.  This avoids two classes of Euler singularity:
    //
    //   Yaw (alpha):  near device-flat (|rawPitch| → 90°), the magnetometer
    //     reference frame can flip, causing alpha to jump by ±180° in a single
    //     frame while the device barely moved.  The yawDamping factor cos(rawPitch)
    //     smoothly reduces yaw sensitivity to zero exactly where alpha is
    //     meaningless.
    //
    //   Pitch (beta/gamma):  as beta approaches 0° (device flat), iOS sensor
    //     fusion can snap beta between 0° and ±180° in a single frame.  An
    //     absolute formula like (beta-90) would see a ~180° pitch jump.
    //     Incrementally accumulated pitch doesn't snap.
    //
    // Glitch protection: instead of capping every frame (which throttles normal
    // movement at low sensor rates), skip any frame whose per-axis delta exceeds
    // GLITCH_THRESHOLD_DEG.  No human hand can rotate a device faster than
    // ~30°/frame at 30 Hz (= 900°/s); anything larger is a singularity spike.
    // The camera just freezes for that single frame rather than jumping or being
    // slowed down.

    const GLITCH_THRESHOLD_DEG = 30;

    let prevAlpha: number | null = null;
    let prevRawPitch: number | null = null;
    let accYaw: number | null = null;
    let accPitch: number | null = null;
    // Lock screen angle at calibration time; re-lock after recalibrate.
    // Avoids mid-tilt formula switches if the screen auto-rotates.
    let lockedScreenAngle: number | null = null;

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

      // Lock screen angle on first event so a mid-session auto-rotate doesn't
      // switch the pitch axis formula unexpectedly mid-tilt.
      if (lockedScreenAngle === null) lockedScreenAngle = getScreenAngle();
      const rawPitch = calcRawPitch(beta, gamma, lockedScreenAngle);

      // First event: anchor accumulators to the camera's current orientation
      // so enabling motion never snaps the view.
      if (prevAlpha === null) {
        prevAlpha     = alpha;
        prevRawPitch  = rawPitch;
        accYaw        = camera.rotation.y;
        accPitch      = camera.rotation.x;
        return; // skip this frame; deltas are zero by definition
      }

      // ── Yaw (incremental + cosine damping + glitch skip) ───────────────────
      let deltaAlpha = alpha - prevAlpha;
      if (deltaAlpha >  180) deltaAlpha -= 360;
      if (deltaAlpha < -180) deltaAlpha += 360;
      prevAlpha = alpha;

      if (Math.abs(deltaAlpha) <= GLITCH_THRESHOLD_DEG) {
        const yawDamping = Math.cos(THREE.MathUtils.degToRad(rawPitch));
        accYaw = (accYaw ?? camera.rotation.y) +
          THREE.MathUtils.degToRad(deltaAlpha) * yawDamping;
      }

      // ── Pitch (incremental + glitch skip) ──────────────────────────────────
      const deltaPitch = rawPitch - (prevRawPitch ?? rawPitch);
      prevRawPitch = rawPitch;

      if (Math.abs(deltaPitch) <= GLITCH_THRESHOLD_DEG) {
        accPitch = Math.max(
          -Math.PI * 85 / 180,
          Math.min(
            Math.PI * 85 / 180,
            (accPitch ?? camera.rotation.x) + THREE.MathUtils.degToRad(deltaPitch),
          ),
        );
      }

      camera.rotation.set(accPitch, accYaw, 0, 'YXZ');
    };

    window.addEventListener('deviceorientation', handler);
    // Re-calibrate if the screen orientation changes so the next event
    // re-locks to the new screen angle and re-anchors the camera.
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
