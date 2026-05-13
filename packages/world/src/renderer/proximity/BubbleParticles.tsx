import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * Procedural radial-gradient texture used as the bubble glow `map`.
 * Module-scoped so every instance (and the per-player ground discs
 * in ProximityGlow that import it) shares one texture.
 */
export const radialTexture = (() => {
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

export interface BubbleParticlesProps {
  count: number;
  color: string;
  /** World-space size multiplier on the per-particle point size. */
  sizeMul: number;
  /** Multiplier on the per-particle rise speed (Leva tunable). */
  speedMul: number;
  /** Maximum Y (m) above the ground a bubble rises to before
   * wrapping back down. */
  floatHeight: number;
  /** `disc` lays bubbles inside a circle of given radii (radial
   * jitter on each frame); `annulus` lays them on a ring whose
   * inner / outer radii are derived from a live radius ref +
   * world-space offsets. */
  layout: 'disc' | 'annulus';
  innerRadius?: number;
  outerRadius?: number;
  radiusRef?: React.MutableRefObject<number>;
  innerOffset?: number;
  outerOffset?: number;
}

/**
 * Custom `<points>` cloud whose particles drift UPWARD over time —
 * "floating bubbles". Each particle has its own random angular
 * position, radial offset, vertical speed, and lateral wobble phase
 * so the swarm looks lively rather than synchronised.
 *
 * Soft round look is provided by mapping a `radialTexture` (white
 * core fading to transparent) onto a `PointsMaterial` with additive
 * blending — drei's `<Sparkles>` doesn't support directional drift,
 * which is why we don't reuse it here.
 *
 * Two layouts:
 *  - `disc`: positions uniformly inside a disc bounded by
 *    `innerRadius` and `outerRadius` (per-player approach bubbles).
 *  - `annulus`: positions on a thin ring whose inner/outer radii are
 *    `radiusRef.current - innerOffset` and `radiusRef.current +
 *    outerOffset`. The radius is read each frame so the ring tracks
 *    the live MeetingArea radius without React re-renders.
 */
export function BubbleParticles({
  count,
  color,
  sizeMul,
  speedMul,
  floatHeight,
  layout,
  innerRadius,
  outerRadius,
  radiusRef,
  innerOffset = 0,
  outerOffset = 0,
}: BubbleParticlesProps) {
  // Seed per-particle constants once on mount. The layout-specific
  // mapping happens per-frame (so live radius / offset changes take
  // effect without rebuilding the seed).
  const data = useMemo(() => {
    const angle = new Float32Array(count);
    const radialFrac = new Float32Array(count); // 0..1
    const sizeJitter = new Float32Array(count); // 0..1
    const speedJitter = new Float32Array(count); // 0..1
    const ySeed = new Float32Array(count); // 0..1, initial phase
    const wobbleSeed = new Float32Array(count); // 0..2π
    for (let i = 0; i < count; i++) {
      angle[i] = Math.random() * Math.PI * 2;
      // For disc layouts we want uniform area distribution; for
      // annulus, uniform radial fraction is fine since the band is
      // thin. Use sqrt for disc bias-toward-perimeter.
      radialFrac[i] =
        layout === 'disc' ? Math.sqrt(Math.random()) : Math.random();
      sizeJitter[i] = Math.random();
      // Bubble vertical speed in roughly [0.4, 1.2] m/s (× speedMul).
      speedJitter[i] = 0.4 + Math.random() * 0.8;
      ySeed[i] = Math.random();
      wobbleSeed[i] = Math.random() * Math.PI * 2;
    }
    return { angle, radialFrac, sizeJitter, speedJitter, ySeed, wobbleSeed };
  }, [count, layout]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    return g;
  }, [count]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const arr = geometry.attributes.position.array as Float32Array;

    let innerR: number;
    let outerR: number;
    if (layout === 'disc') {
      outerR = outerRadius ?? 1;
      innerR = Math.max(0.01, outerR - innerOffset); // clamp to non-negative
      outerR = outerR + Math.max(0, outerOffset); // clamp to non-negative
    } else {
      const live = radiusRef ? radiusRef.current : 1;
      innerR = Math.max(0.01, live - innerOffset);
      outerR = live + outerOffset;
    }
    const bandWidth = outerR - innerR;

    for (let i = 0; i < count; i++) {
      const ang =
        data.angle[i] +
        Math.sin(t * 0.2 + data.wobbleSeed[i]) * 0.04;
      const r = innerR + data.radialFrac[i] * bandWidth;
      // Bubble Y: linear rise scaled by speedMul, wraps at
      // floatHeight. ySeed offsets each particle in phase so they
      // don't all reach the top at once.
      const phase = data.ySeed[i] + t * data.speedJitter[i] * speedMul * 0.18;
      const y = (phase - Math.floor(phase)) * floatHeight;
      arr[i * 3 + 0] = Math.cos(ang) * r;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = Math.sin(ang) * r;
    }
    geometry.attributes.position.needsUpdate = true;
  });

  // Per-particle size attribute via PointsMaterial.size — single
  // scalar because PointsMaterial doesn't accept arrays. Per-particle
  // size variation comes via the jitter applied in the texture +
  // small wobble. We pick a base size that combines a reasonable
  // world-space scale with the camera-mode-aware `sizeMul`.
  const baseSize = 0.45 * sizeMul;

  return (
    <points geometry={geometry} renderOrder={3}>
      <pointsMaterial
        size={baseSize}
        map={radialTexture}
        color={color}
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}
