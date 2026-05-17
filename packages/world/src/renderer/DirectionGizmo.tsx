/**
 * DirectionGizmo — a simple arrow gizmo rendered in world space.
 *
 * SRP: this component does one thing — render a directional arrow at a
 * world-space origin pointing along an arbitrary unit vector.
 * Placement decisions (when to show, which direction) live in the
 * consumer (SceneEditorCanvas).
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';

interface DirectionGizmoProps {
  /** World-space origin of the arrow tail. */
  origin: [number, number, number];
  /** Unit vector pointing in the extrusion direction. E.g. [1,0,0] for +X. */
  direction: [number, number, number];
  /** CSS hex color for the arrow mesh. Default '#facc15' (yellow). */
  color?: string;
  /** Total length of the arrow (shaft + head) in world units. Default 1.5. */
  length?: number;
}

/**
 * Renders a 3-D arrow gizmo (cylinder shaft + cone head) in world space.
 *
 * The gizmo geometry is built along the +Y axis and rotated to the target
 * direction via a quaternion. The `depthTest: false` + `renderOrder={1}`
 * combination ensures it is always visible on top of placed objects —
 * desirable for a tiling-direction indicator.
 */
export function DirectionGizmo({
  origin,
  direction,
  color = '#facc15',
  length = 1.5,
}: DirectionGizmoProps) {
  // Compute the quaternion that rotates +Y onto `direction`.
  // setFromUnitVectors degenerates when direction == -Y; handle explicitly.
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(...direction).normalize();

    if (dir.dot(up) < -0.9999) {
      // Anti-parallel: 180° around X axis
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    } else {
      q.setFromUnitVectors(up, dir);
    }
    return q;
  }, [direction]);

  const euler = useMemo(
    () => new THREE.Euler().setFromQuaternion(quaternion),
    [quaternion],
  );

  const shaftLength = length * 0.7;
  const headLength = length * 0.3;

  return (
    <group position={origin} rotation={euler}>
      {/* Shaft: cylinder centred at half its length along +Y */}
      <mesh
        position={[0, shaftLength / 2, 0]}
        renderOrder={1}
      >
        <cylinderGeometry args={[0.05, 0.05, shaftLength, 8]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {/* Head: cone centred at shaftLength + headLength/2 along +Y */}
      <mesh
        position={[0, shaftLength + headLength / 2, 0]}
        renderOrder={1}
      >
        <coneGeometry args={[0.15, headLength, 8]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    </group>
  );
}
