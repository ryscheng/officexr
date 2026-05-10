import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { OfficeState, Store } from '@officexr/sdk';
import { extrapolatePos } from './Players.tsx';

interface ProximityGlowProps {
  store: Store;
  /** XZ distance under which the glow appears (pulsing) on BOTH characters. */
  outerRadius: number;
  /** XZ distance under which characters are considered "in proximity" — the
   * glow stops pulsing and becomes a steady, full-intensity light. */
  innerRadius: number;
  /** Visual size of the disc on the ground (independent of outerRadius). */
  discRadius: number;
  /** Pulses per second. 1.0 = one full bright→dim cycle each second. */
  pulseSpeed: number;
  /** CSS color string. */
  color: string;
  /** Peak alpha at the bright phase of the pulse. */
  intensity: number;
}

/**
 * Procedural radial-gradient texture, used as the glow disc's `map`.
 * Module-scoped so every instance shares one texture (cheap to create,
 * cheap to keep around).
 */
const radialTexture = (() => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  // White center → transparent edge. Color comes from material.color so the
  // texture is reusable across hue choices.
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

interface DiscRegistration {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

/**
 * Renders a soft, pulsing disc on the ground beneath each player when ANY
 * other player is within `outerRadius` (XZ).
 *
 * Uses MeshBasicMaterial + a radial-gradient texture instead of a custom
 * shader — battle-tested path that avoids the `transparent`/AdditiveBlending
 * gotcha and gets correct color out of the box.
 */
export function ProximityGlow({
  store,
  outerRadius,
  innerRadius,
  discRadius,
  pulseSpeed,
  color,
  intensity,
}: ProximityGlowProps) {
  const initialIds = useMemo(
    () => Object.keys(store.getState().players),
    [store],
  );
  const [playerIds, setPlayerIds] = useState<string[]>(initialIds);

  useEffect(() => {
    return store.subscribeAll((next: OfficeState, prev: OfficeState) => {
      const a = Object.keys(next.players);
      const b = Object.keys(prev.players);
      if (a.length === b.length && a.every((id, i) => id === b[i])) return;
      setPlayerIds(a);
    });
  }, [store]);

  const registry = useRef<Map<string, DiscRegistration>>(new Map());
  const currentI = useRef<Map<string, number>>(new Map());
  const glowColor = useMemo(() => new THREE.Color(color), [color]);

  const register = useCallback(
    (id: string, entry: DiscRegistration | null) => {
      if (entry) registry.current.set(id, entry);
      else registry.current.delete(id);
    },
    [],
  );

  // Scratch vectors reused per-frame to avoid allocation churn.
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const renderedPositions = useRef<Map<string, THREE.Vector3>>(new Map());

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(t * pulseSpeed * Math.PI * 2);
    const players = store.getState().players;
    const entries = Object.entries(players);
    const outer2 = outerRadius * outerRadius;
    const inner2 = innerRadius * innerRadius;

    // First pass: compute extrapolated positions so they match what Players
    // is actually rendering. Otherwise the disc lags behind a remote avatar.
    renderedPositions.current.clear();
    for (const [id, p] of entries) {
      const v = new THREE.Vector3();
      extrapolatePos(p, now, v);
      renderedPositions.current.set(id, v);
    }

    for (const [id, p] of entries) {
      const myPos = renderedPositions.current.get(id) ?? tmpA;
      // Two-tier sensor:
      //   inProximity (within innerRadius) → glow is constant at full intensity
      //   approaching  (within outerRadius)  → glow pulses
      //   else                               → no glow
      let inProximity = false;
      let approaching = false;
      for (const [otherId] of entries) {
        if (otherId === id) continue;
        const otherPos = renderedPositions.current.get(otherId) ?? tmpB;
        const ddx = myPos.x - otherPos.x;
        const ddz = myPos.z - otherPos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 <= inner2) {
          inProximity = true;
          break;
        }
        if (d2 <= outer2) approaching = true;
      }

      const target = inProximity
        ? intensity
        : approaching
          ? intensity * pulse
          : 0;
      const prev = currentI.current.get(id) ?? 0;
      const next = prev + (target - prev) * Math.min(1, 6 * dt);
      currentI.current.set(id, next);

      const reg = registry.current.get(id);
      if (!reg) continue;
      reg.mesh.position.set(myPos.x, p.pos.y + 0.02, myPos.z);
      reg.material.opacity = next;
      reg.material.color.copy(glowColor);
    }
  });

  return (
    <>
      {playerIds.map((id) => (
        <GlowDisc
          key={id}
          id={id}
          radius={discRadius}
          register={register}
        />
      ))}
    </>
  );
}

interface GlowDiscProps {
  id: string;
  radius: number;
  register: (id: string, entry: DiscRegistration | null) => void;
}

function GlowDisc({ id, radius, register }: GlowDiscProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    if (meshRef.current && matRef.current) {
      register(id, { mesh: meshRef.current, material: matRef.current });
    }
    return () => register(id, null);
  }, [id, register]);

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
      // The disc sits just above the floor; depth-test stays on so the
      // character's body occludes its own glow if you crouch into it,
      // but we don't write depth so additive overlap is clean.
    >
      <circleGeometry args={[radius, 64]} />
      <meshBasicMaterial
        ref={matRef}
        map={radialTexture}
        color={0xffffff}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
