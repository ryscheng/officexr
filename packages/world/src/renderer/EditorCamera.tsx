import React from 'react';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';

interface EditorCameraProps {
  /** Initial world-space camera position. */
  position?: [number, number, number];
  /** What the camera orbits + looks at. */
  target?: [number, number, number];
  /** FOV in degrees. */
  fov?: number;
  /** Near / far clip. */
  near?: number;
  far?: number;
  /** Allow middle-button / shift-right-button pan. Object previews
   * leave this off so the kind stays centered; scene editors that
   * want to navigate around a larger area turn it on. */
  enablePan?: boolean;
  /** Min/max orbit distance from target. */
  minDistance?: number;
  maxDistance?: number;
  /** Whether the orbit responds to user input at all. False is
   * useful for snapshot tests where the camera must be fixed. */
  enabled?: boolean;
}

/**
 * The studio's canonical editor camera: a perspective camera +
 * `OrbitControls` from drei with consistent damping + sane defaults.
 * Editors that need richer cameras (Map's WASD fly, Room's middle-
 * click pan, Character's mode-switch follow camera) keep their
 * bespoke implementations — this primitive covers the "orbit a
 * small subject in a preview" case shared by Object preview and
 * other future per-kind / per-asset previews.
 *
 * Composes drei components only — no manual scene mutation, no
 * raycast handling. Editors stay declarative.
 */
export function EditorCamera({
  position = [4, 3, 4],
  target = [0, 0, 0],
  fov = 45,
  near = 0.1,
  far = 200,
  enablePan = false,
  minDistance = 1.5,
  maxDistance = 40,
  enabled = true,
}: EditorCameraProps) {
  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={position}
        fov={fov}
        near={near}
        far={far}
      />
      <OrbitControls
        target={target}
        enableDamping
        enablePan={enablePan}
        minDistance={minDistance}
        maxDistance={maxDistance}
        enabled={enabled}
      />
    </>
  );
}
