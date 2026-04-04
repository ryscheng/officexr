import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export type MotionPermission = 'unavailable' | 'prompt' | 'granted' | 'denied';

interface UseMotionControlsOptions {
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
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

    // Offsets captured on the first event so that enabling motion does NOT snap
    // the camera to a new direction — it continues from wherever it was pointing.
    let alphaOffset: number | null = null;       // device yaw at activation
    let devicePitchOffset: number | null = null; // device pitch at activation
    let cameraYawAtStart: number | null = null;  // camera yaw at activation
    let cameraPitchAtStart: number | null = null;// camera pitch at activation

    const recalibrate = () => {
      alphaOffset = null;
      devicePitchOffset = null;
      cameraYawAtStart = null;
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

      // Raw device pitch in the current screen orientation
      const screenAngle = window.screen?.orientation?.angle ?? 0;
      let rawPitch: number;
      if (screenAngle === 90 || screenAngle === -270) {
        rawPitch = gamma;   // landscape-left
      } else if (screenAngle === 270 || screenAngle === -90) {
        rawPitch = -gamma;  // landscape-right
      } else {
        rawPitch = beta - 90; // portrait: 0° when held upright
      }

      // On the very first event after activation, anchor to the camera's current
      // orientation so there is no jarring snap when motion is enabled.
      if (alphaOffset === null) {
        alphaOffset       = alpha;
        devicePitchOffset = rawPitch;
        cameraYawAtStart   = camera.rotation.y;
        cameraPitchAtStart = camera.rotation.x;
      }

      // Delta yaw from initial heading, wrapped to [-180, 180]
      let deltaAlpha = alpha - alphaOffset;
      if (deltaAlpha >  180) deltaAlpha -= 360;
      if (deltaAlpha < -180) deltaAlpha += 360;

      const yaw   = (cameraYawAtStart ?? 0)   + THREE.MathUtils.degToRad(deltaAlpha);
      const pitch = (cameraPitchAtStart ?? 0) + THREE.MathUtils.degToRad(rawPitch - (devicePitchOffset ?? 0));

      camera.rotation.set(
        Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)),
        yaw,
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
