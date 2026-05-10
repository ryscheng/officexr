import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { EYE_HEIGHT, type CameraMode } from './config.ts';

const PITCH_MIN = -1.3;
const PITCH_MAX = 1.3;
const MOUSE_SENSITIVITY = 0.0025;
const THIRD_PERSON_RADIUS = 6;

interface CameraRigProps {
  mode: CameraMode;
  /** Provides the local player's world position each frame. */
  playerPosRef: React.RefObject<THREE.Vector3>;
  /** Mutable yaw shared with movement code so WASD is camera-relative. */
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  /** Fixed-camera params, updated live from the debug panel. */
  fixed: {
    azimuthDeg: number;
    elevationDeg: number;
    distance: number;
    fov: number;
  };
}

/**
 * Owns the active camera each frame. Three modes:
 *  - first-person: at player eye height, mouse-look (pointer lock)
 *  - third-person: orbits behind player, mouse-look (pointer lock)
 *  - fixed: parked at a configurable azimuth/elevation/distance, looks at player
 */
export function CameraRig({
  mode,
  playerPosRef,
  yawRef,
  pitchRef,
  fixed,
}: CameraRigProps) {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  // Pointer-lock + mouse-look — only active in first/third person modes.
  useEffect(() => {
    const wantsLook = mode === 'first-person' || mode === 'third-person';
    const canvas = gl.domElement;

    if (!wantsLook) {
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      return;
    }

    const onMouseDown = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
      if (pitchRef.current < PITCH_MIN) pitchRef.current = PITCH_MIN;
      if (pitchRef.current > PITCH_MAX) pitchRef.current = PITCH_MAX;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, [mode, gl, yawRef, pitchRef]);

  // Keep fixed-camera fov in sync with the panel slider.
  useEffect(() => {
    if (mode === 'fixed') {
      persp.fov = fixed.fov;
      persp.updateProjectionMatrix();
    } else {
      persp.fov = 75;
      persp.updateProjectionMatrix();
    }
  }, [mode, fixed.fov, persp]);

  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    const pos = playerPosRef.current;
    if (!pos) return;
    const yaw = yawRef.current;
    const pitch = pitchRef.current;

    if (mode === 'first-person') {
      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      target.current.set(
        pos.x - Math.sin(yaw) * Math.cos(pitch),
        pos.y + EYE_HEIGHT + Math.sin(pitch),
        pos.z - Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target.current);
    } else if (mode === 'third-person') {
      const r = THIRD_PERSON_RADIUS;
      const head = target.current.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      camera.position.set(
        head.x + Math.sin(yaw) * Math.cos(pitch) * r,
        head.y + Math.sin(pitch) * r,
        head.z + Math.cos(yaw) * Math.cos(pitch) * r,
      );
      camera.lookAt(head);
    } else {
      // fixed
      const az = THREE.MathUtils.degToRad(fixed.azimuthDeg);
      const el = THREE.MathUtils.degToRad(fixed.elevationDeg);
      const horiz = fixed.distance * Math.cos(el);
      const y = fixed.distance * Math.sin(el);
      // Compass: 0 = N (-Z), 90 = E (+X), 180 = S (+Z), 270 = W (-X)
      const x = Math.sin(az) * horiz;
      const z = -Math.cos(az) * horiz;
      camera.position.set(x, y, z);
      camera.lookAt(pos.x, pos.y, pos.z);
    }
  });

  return null;
}
