import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getCubeKind } from '@officexr/world';
import type { WorldObjects, ObjectInstance } from '@officexr/sdk';
import { ObjectInstances, type MaterialOverride } from '@officexr/world/renderer';

/**
 * Render mode for a ghost cube:
 *   - `solid`: 50% transparent, static. Used by the Add tool and
 *     by the Tile tool's pre-click + in-flight previews.
 *   - `pulse`: 25%–75% transparent oscillation. Used by the Delete
 *     tool to denote "click will delete this". The PulseDriver
 *     mounts only when at least one pulse-mode ghost exists.
 *   - `blocked`: red-tinted (color #ef4444), 50% opacity, static.
 *     Used by the Move tool when the proposed destination overlaps a
 *     non-moving object — signals that releasing here is rejected.
 */
export type GhostMode = 'solid' | 'pulse' | 'blocked';

export interface GhostSpec {
  mode: GhostMode;
  kindId: string;
  voxel: [number, number, number];
}

interface GhostLayerProps {
  ghosts: readonly GhostSpec[];
  cubeSize: number;
}

/**
 * Renders ghost cubes for the Add / Tile / Delete tool previews.
 *
 * Composes the shared `<ObjectInstances>` renderer with a transient
 * material override (transparent, depth-write off, double-sided) per
 * ghost mode. One `<ObjectInstances>` mount per `(mode, kindId)`
 * pair so the materials can stay distinct (pulse ghosts mutate
 * `opacity` per frame; solid ghosts hold 0.5).
 *
 * Ghosts opt out of the picking raycaster via a wrapper `<group>`
 * whose own `raycast` is a no-op. Without this, the Add/Tile tools
 * could snap to their own ghost preview.
 */
export function GhostLayer({ ghosts, cubeSize }: GhostLayerProps) {
  // Group ghosts by (mode, kindId).
  const groups = useMemo(() => {
    const m = new Map<
      string,
      { mode: GhostMode; kindId: string; voxels: [number, number, number][] }
    >();
    for (const g of ghosts) {
      const key = `${g.mode}:${g.kindId}`;
      let bucket = m.get(key);
      if (!bucket) {
        bucket = { mode: g.mode, kindId: g.kindId, voxels: [] };
        m.set(key, bucket);
      }
      bucket.voxels.push([...g.voxel]);
    }
    return Array.from(m.values());
  }, [ghosts]);

  const hasPulse = groups.some((g) => g.mode === 'pulse');

  // One shared "pulse opacity" ref that every pulse material reads
  // each frame. Driver mounted exactly when needed.
  const pulseOpacityRef = useRef<number>(0.5);
  return (
    <>
      {groups.map((g) => (
        <GhostGroup
          key={`${g.mode}:${g.kindId}`}
          mode={g.mode}
          kindId={g.kindId}
          voxels={g.voxels}
          cubeSize={cubeSize}
          pulseOpacityRef={pulseOpacityRef}
        />
      ))}
      {hasPulse ? <PulseDriver opacityRef={pulseOpacityRef} /> : null}
    </>
  );
}

interface GhostGroupProps {
  mode: GhostMode;
  kindId: string;
  voxels: [number, number, number][];
  cubeSize: number;
  pulseOpacityRef: React.MutableRefObject<number>;
}

/**
 * One `<ObjectInstances>` mount for a single (mode, kindId) bucket.
 * The kind's base material is cloned by the override and tracked
 * via a ref so `useFrame` can mutate its `opacity` for pulse mode
 * without forcing material rebuilds.
 */
function GhostGroup({
  mode,
  kindId,
  voxels,
  cubeSize,
  pulseOpacityRef,
}: GhostGroupProps) {
  const kind = getCubeKind(kindId);

  // Build the snapshot. Voxels are translated into `ObjectInstance`
  // shape so ObjectInstances can render them. ids are synthesised
  // (ghost instances have no source command).
  const worldObjects = useMemo<WorldObjects>(() => {
    const instances: ObjectInstance[] = voxels.map((v, i) => ({
      id: `ghost-${mode}-${kindId}-${i}`,
      sourceCommandId: `ghost-${mode}-${kindId}-${i}`,
      kindId,
      position: v,
    }));
    return { cubeSize, instances };
  }, [voxels, cubeSize, kindId, mode]);

  // The override holds the cloned material in a ref so the pulse
  // driver can mutate its `opacity` per frame without triggering
  // React re-renders. The ref is also disposed on unmount.
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  useEffect(() => {
    return () => {
      matRef.current?.dispose();
      matRef.current = null;
    };
  }, []);

  const initialOpacity = mode === 'pulse' ? pulseOpacityRef.current : 0.5;

  const materialOverride = useCallback<MaterialOverride>(
    (_kid, base) => {
      // Already cloned? Just sync the per-mode initial opacity (pulse
      // is overwritten every frame; solid/blocked use 0.5).
      if (matRef.current) {
        matRef.current.opacity = initialOpacity;
        return matRef.current;
      }
      const m = (base as THREE.MeshStandardMaterial).clone();
      m.transparent = true;
      m.opacity = initialOpacity;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      // Blocked mode: red tint to signal the position is occupied.
      if (mode === 'blocked') {
        m.color.set('#ef4444');
      }
      matRef.current = m;
      return m;
    },
    [initialOpacity, mode],
  );

  // Pulse driver mutates the cloned material in place each frame —
  // no React state, no override re-runs.
  useFrame(() => {
    if (mode !== 'pulse') return;
    if (matRef.current) matRef.current.opacity = pulseOpacityRef.current;
  });

  if (!kind || voxels.length === 0) return null;

  // The wrapper group's `raycast` is a no-op so ghost cubes never
  // enter the pointer-event raycaster — the Add/Tile tools would
  // otherwise snap to their own previews. `renderOrder={1}` keeps
  // ghosts drawn after the opaque cube field for stable blending.
  return (
    <group raycast={NO_RAYCAST} renderOrder={1}>
      <ObjectInstances worldObjects={worldObjects} materialOverride={materialOverride} />
    </group>
  );
}

// `Object3D.raycast` is `(raycaster, intersects) => void`. A no-op
// satisfies the contract without recording any intersection — which
// disables picking for every descendant. We use the same function
// reference so React's prop diffing doesn't trip on a fresh closure.
const NO_RAYCAST: THREE.Object3D['raycast'] = () => {};

interface PulseDriverProps {
  opacityRef: React.MutableRefObject<number>;
}

/**
 * Drives the shared pulse-mode opacity ref. One driver fed by every
 * pulse ghost in the scene — opacity is one shared value, not per
 * mesh, so the pulse stays in sync across a whole group hover.
 */
function PulseDriver({ opacityRef }: PulseDriverProps) {
  useFrame(({ clock }) => {
    // 0.25 → 0.75 sinusoid at 4 rad/s (period ~1.5s). Centered at
    // 0.5 so a static pulse-mode glow is visible even mid-animation.
    opacityRef.current = 0.5 + 0.25 * Math.sin(clock.elapsedTime * 4);
  });
  return null;
}
