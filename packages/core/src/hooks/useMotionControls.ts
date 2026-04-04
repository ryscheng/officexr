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

  // Detect device orientation capability once on mount
  useEffect(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return;
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      setMotionPermission('prompt'); // iOS 13+ — needs explicit user gesture
    } else {
      setMotionPermission('granted'); // Android / older iOS — always available
    }
  }, []);

  // Keep motionActiveRef in sync so Three.js event handlers can read it
  useEffect(() => {
    motionActiveRef.current = motionPermission === 'granted';
  }, [motionPermission]);

  // Attach deviceorientation listener whenever permission is granted
  useEffect(() => {
    if (motionPermission !== 'granted') return;

    let alphaOffset: number | null = null;
    recalibrateMotionRef.current = () => { alphaOffset = null; };

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

      // Capture the initial heading so the current look direction = yaw 0
      if (alphaOffset === null) alphaOffset = alpha;

      let relAlpha = alpha - alphaOffset;
      if (relAlpha >  180) relAlpha -= 360;
      if (relAlpha < -180) relAlpha += 360;

      const yaw = THREE.MathUtils.degToRad(relAlpha);

      // Pitch mapping differs between portrait and landscape.
      // Portrait: beta ≈ 90 when upright; tilting up decreases beta.
      const screenAngle = window.screen?.orientation?.angle ?? 0;
      let pitch: number;
      if (screenAngle === 90 || screenAngle === -270) {
        pitch = THREE.MathUtils.degToRad(gamma);   // landscape-left
      } else if (screenAngle === 270 || screenAngle === -90) {
        pitch = THREE.MathUtils.degToRad(-gamma);  // landscape-right
      } else {
        pitch = THREE.MathUtils.degToRad(beta - 90); // portrait
      }

      pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
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

  return {
    motionPermission,
    motionActiveRef,
    recalibrateMotionRef,
    handleRequestMotionPermission,
  };
}
