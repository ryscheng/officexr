import React, { useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { XROrigin } from '@react-three/xr';
import { feetPosition } from '../physics/rules.ts';

/** Keeps the XR origin (the user's feet, with `local-floor`) on the self avatar's feet. Mount inside `<XR>`. */
export function XRAvatarOrigin({
  selfPosRef,
  charRadius,
}: {
  selfPosRef: React.RefObject<THREE.Vector3>;
  charRadius: number;
}) {
  const originRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const feet = feetPosition(selfPosRef.current, charRadius);
    originRef.current?.position.set(feet.x, feet.y, feet.z);
  });
  return <XROrigin ref={originRef} />;
}
