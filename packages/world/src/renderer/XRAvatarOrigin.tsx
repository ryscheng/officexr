import React, { useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { XROrigin } from '@react-three/xr';

/** Keeps the XR origin (the user's feet, with `local-floor`) on the self avatar. Mount inside `<XR>`. */
export function XRAvatarOrigin({ selfPosRef }: { selfPosRef: React.RefObject<THREE.Vector3> }) {
  const originRef = useRef<THREE.Group>(null);
  useFrame(() => {
    originRef.current?.position.copy(selfPosRef.current);
  });
  return <XROrigin ref={originRef} />;
}
