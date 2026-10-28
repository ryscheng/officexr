import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { lightBasis, snapToShadowTexel } from './shadow-snap.ts';

const OFFSETS = [
  [20, 40, 20],
  [-10, 5, 30],
  [0, 50, 1],
  [35, 2, -8],
] as const;
const TEXEL = 2 * 40 / 2048;

describe('snapToShadowTexel', () => {
  const basis = lightBasis(OFFSETS[0]);
  const snap = (p: THREE.Vector3) => snapToShadowTexel(p, basis, TEXEL, new THREE.Vector3());
  const p = new THREE.Vector3(3.3711, 1.2, -7.9137);

  it('moves at most half a texel in right/up and not at all in depth', () => {
    const s = snap(p);
    expect(Math.abs(s.clone().sub(p).dot(basis.right))).toBeLessThanOrEqual(TEXEL / 2 + 1e-9);
    expect(Math.abs(s.clone().sub(p).dot(basis.up))).toBeLessThanOrEqual(TEXEL / 2 + 1e-9);
    expect(s.dot(basis.back)).toBeCloseTo(p.dot(basis.back), 9);
  });

  it('is stable under sub-texel moves and shifts by one texel for a full-texel move', () => {
    const base = snap(p);
    for (const k of [-0.4, 0.4]) {
      const near = snap(base.clone().addScaledVector(basis.right, TEXEL * k));
      expect(near.distanceTo(base)).toBeLessThan(1e-9);
    }
    const shifted = snap(p.clone().addScaledVector(basis.right, TEXEL));
    expect(shifted.clone().sub(base).dot(basis.right)).toBeCloseTo(TEXEL, 9);
    expect(shifted.clone().sub(base).length()).toBeCloseTo(TEXEL, 9);
  });

  it.each(OFFSETS)('basis matches the three.js shadow camera for sun offset %j', (...offset) => {
    const light = new THREE.DirectionalLight();
    light.position.set(...offset);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    const b = lightBasis(offset);
    const cam = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const camBack = new THREE.Vector3();
    light.shadow.camera.matrixWorld.extractBasis(cam, camUp, camBack);
    expect(b.right.distanceTo(cam)).toBeLessThan(1e-6);
    expect(b.up.distanceTo(camUp)).toBeLessThan(1e-6);
    expect(b.back.distanceTo(camBack)).toBeLessThan(1e-6);
  });

  it('does not produce NaN for a vertical sun', () => {
    const b = lightBasis([0, 40, 0]);
    const s = snapToShadowTexel(p, b, TEXEL, new THREE.Vector3());
    expect(Number.isNaN(s.x + s.y + s.z)).toBe(false);
  });
});
