import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { CHAR_HEIGHT_M, EYE_HEIGHT, type CameraMode } from './config.ts';

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
    /** Camera pitch in degrees (negative = looking down). */
    pitchDeg: number;
    /** Camera Y offset above the character. */
    height: number;
    /** Screen-fraction bounds. The actual meter distances are derived each
     * frame from these plus FOV and height — so the leash auto-adjusts when
     * the user changes any of those. */
    maxOnScreenFrac: number;
    minOnScreenFrac: number;
    /** Lateral half-width as a fraction of the view's half-width at the far
     * depth. Translates to world units inside the rig. */
    lateralFrac: number;
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

  // True when fixed-mode just became active and the camera position needs to
  // snap to a sensible starting point relative to the character.
  const fixedNeedsInit = useRef(false);

  useEffect(() => {
    if (mode === 'fixed') fixedNeedsInit.current = true;
  }, [mode]);

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
      // Fixed-orientation leash camera.
      //   - Orientation comes ONLY from azimuth + pitch — never tracks the
      //     character. The camera does not rotate as the player moves.
      //   - Y is locked at character.y + height (no bobbing).
      //   - XZ position is moved only when XZ distance to the character
      //     leaves [minDistance, maxDistance]. Within bounds the camera
      //     stays put while the character wanders.
      const az = THREE.MathUtils.degToRad(fixed.azimuthDeg);
      const pitch = THREE.MathUtils.degToRad(fixed.pitchDeg);

      // Derive leash distances from screen fractions. The character should
      // occupy ~maxOnScreenFrac of the screen at the near bound, dwindling
      // to ~minOnScreenFrac at the far bound.
      //   screenFrac ≈ charHeight / (2 · distance3D · tan(fov/2))
      //   ⇒ distance3D = charHeight / (2 · frac · tan(fov/2))
      // Then project to XZ depth using the camera's height above the
      // character's center: depth = sqrt(distance3D² − heightOffset²).
      const fovRad = THREE.MathUtils.degToRad(fixed.fov);
      const tanHalfFov = Math.tan(fovRad / 2);
      const heightOffset = Math.max(0, fixed.height - CHAR_HEIGHT_M / 2);
      const safeMaxFrac = Math.max(0.005, fixed.maxOnScreenFrac);
      const safeMinFrac = Math.max(0.001, fixed.minOnScreenFrac);
      const dNear3D = CHAR_HEIGHT_M / (2 * safeMaxFrac * tanHalfFov);
      const dFar3D = CHAR_HEIGHT_M / (2 * safeMinFrac * tanHalfFov);
      const minDistance = Math.sqrt(
        Math.max(0.01, dNear3D * dNear3D - heightOffset * heightOffset),
      );
      const maxDistance = Math.max(
        minDistance + 0.5,
        Math.sqrt(
          Math.max(0.01, dFar3D * dFar3D - heightOffset * heightOffset),
        ),
      );
      const maxLateral = fixed.lateralFrac * maxDistance * tanHalfFov;

      // Initialize position on entry into fixed mode so the character is
      // visible at the default leash distance.
      if (fixedNeedsInit.current) {
        fixedNeedsInit.current = false;
        const initialDist = (minDistance + maxDistance) / 2;
        camera.position.set(
          pos.x + Math.sin(az) * initialDist,
          pos.y + fixed.height,
          pos.z - Math.cos(az) * initialDist,
        );
      }

      // Lock Y to the character's height each frame.
      camera.position.y = pos.y + fixed.height;

      // Decompose the (camera → character) XZ vector into a depth component
      // along the camera's forward axis and a lateral component along the
      // camera's right axis. The two leashes are independent: depth is
      // clamped to [minDistance, maxDistance], lateral to ±maxLateral.
      const forwardX = -Math.sin(az);
      const forwardZ = Math.cos(az);
      const rightX = -Math.cos(az);
      const rightZ = -Math.sin(az);

      const rx = pos.x - camera.position.x;
      const rz = pos.z - camera.position.z;
      const parallel = rx * forwardX + rz * forwardZ;
      const perp = rx * rightX + rz * rightZ;

      const clampedParallel = Math.max(
        minDistance,
        Math.min(maxDistance, parallel),
      );
      const clampedPerp = Math.max(
        -maxLateral,
        Math.min(maxLateral, perp),
      );
      const depthCorrection = parallel - clampedParallel;
      const lateralCorrection = perp - clampedPerp;

      camera.position.x +=
        forwardX * depthCorrection + rightX * lateralCorrection;
      camera.position.z +=
        forwardZ * depthCorrection + rightZ * lateralCorrection;

      // Camera looks toward (azimuth + 180°), tilted by pitch. The look
      // target is camera.position + forward, so orientation is independent
      // of the character's position.
      const lookYaw = az + Math.PI;
      const cosP = Math.cos(pitch);
      camera.lookAt(
        camera.position.x + Math.sin(lookYaw) * cosP,
        camera.position.y + Math.sin(pitch),
        camera.position.z - Math.cos(lookYaw) * cosP,
      );
    }
  });

  return null;
}
