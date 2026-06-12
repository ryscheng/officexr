/**
 * Unit tests for the shared horizontalProgress helper.
 *
 * These are pure-math tests — no Rapier, no Three, no React.
 * Each test exercises a distinct part of the contract documented
 * in blocking.ts.
 */

import { describe, it, expect } from 'vitest';
import { horizontalProgress } from './blocking.ts';

describe('horizontalProgress', () => {
  it('returns 1.0 for full forward progress (corrected == intent)', () => {
    // Character walked exactly as intended: corrected = intent.
    const result = horizontalProgress({ x: 0, z: 0.29 }, { x: 0, z: 0.29 });
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for a full block (corrected == zero vector)', () => {
    // KCC resolved movement to zero — wall or head-on sphere contact.
    const result = horizontalProgress({ x: 0, z: 0 }, { x: 0, z: 0.29 });
    expect(result).toBeCloseTo(0, 5);
  });

  it('returns 0 for backward motion (corrected is opposite to intent)', () => {
    // Sphere surface at head-on contact: KCC pushes character backward.
    // Old magnitude formula gives ≈0.42 here — dot-product gives 0.
    const result = horizontalProgress({ x: 0, z: -0.12 }, { x: 0, z: 0.29 });
    expect(result).toBe(0);
  });

  it('returns a positive fraction for a glancing wall slide', () => {
    // Intent is straight-ahead; wall forces character slightly sideways.
    // The component along intent is positive but less than full.
    // e.g. intent = (0, 1), corrected = (0.8, 0.6) — dot = 0.6, lenSq = 1 → 0.6
    const result = horizontalProgress({ x: 0.8, z: 0.6 }, { x: 0, z: 1 });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
    expect(result).toBeCloseTo(0.6, 5);
  });

  it('returns 1 when intent is the zero vector (no blocking decision needed)', () => {
    // Gravity-only frame — no horizontal intent.
    const result = horizontalProgress({ x: 0, z: 0 }, { x: 0, z: 0 });
    expect(result).toBe(1);
  });

  it('returns 1 when intent is effectively zero (below 1e-12 threshold)', () => {
    // Intent vector tiny enough to be below floating-point threshold.
    const result = horizontalProgress({ x: 0, z: 1e-7 }, { x: 0, z: 1e-7 });
    // intentLenSq = 1e-14 < 1e-12 → returns 1
    expect(result).toBe(1);
  });

  it('clamps result to [0, 1] — never exceeds 1', () => {
    // Corrected is larger than intent (shouldn't happen in practice, but
    // the contract guarantees clamping).
    const result = horizontalProgress({ x: 0, z: 1.5 }, { x: 0, z: 1.0 });
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('works for diagonal intent', () => {
    // Intent is diagonal; corrected matches → progress should be 1.
    const result = horizontalProgress({ x: 0.2, z: 0.2 }, { x: 0.2, z: 0.2 });
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns 0 when corrected is perpendicular to intent', () => {
    // Orthogonal slide — no component along intent direction.
    // intent = (0, 1), corrected = (1, 0) → dot = 0 → 0.
    const result = horizontalProgress({ x: 1, z: 0 }, { x: 0, z: 1 });
    expect(result).toBeCloseTo(0, 5);
  });
});
