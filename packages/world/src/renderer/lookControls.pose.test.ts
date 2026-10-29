import { describe, expect, it } from 'vitest';
import { eyePosition, orbitPosition } from './lookControls.ts';
import { EYE_HEIGHT } from './config.ts';
import { feetPosition } from '../physics/rules.ts';

const bodyRoot = { x: 2, y: 1, z: -3 };

describe.each([0.4, 0.25])('with charRadius %s', (charRadius) => {
  const feet = feetPosition(bodyRoot, charRadius);
  const eye = eyePosition(bodyRoot, charRadius);

  it('puts the first-person eye EYE_HEIGHT above the feet', () => {
    expect(eye).toEqual({ x: feet.x, y: expect.closeTo(feet.y + EYE_HEIGHT, 9), z: feet.z });
  });

  it('orbits the third-person camera around the eye at a level pitch', () => {
    const camera = orbitPosition(eye, 0.7, 0, 6);
    expect(camera.y).toBeCloseTo(feet.y + EYE_HEIGHT, 9);
    expect(Math.hypot(camera.x - eye.x, camera.z - eye.z)).toBeCloseTo(6, 9);
  });

  it('raises the third-person camera above the eye for a look-down pitch', () => {
    const camera = orbitPosition(eye, 0.7, -0.25, 6);
    expect(camera.y).toBeGreaterThan(eye.y);
    expect(Math.hypot(camera.x - eye.x, camera.y - eye.y, camera.z - eye.z)).toBeCloseTo(6, 9);
  });
});

describe('orbitPosition', () => {
  const centre = { x: 0, y: 0, z: 0 };

  it('sits behind the look direction of the yaw', () => {
    // Yaw 0 looks toward -z, so the camera is on +z.
    const camera = orbitPosition(centre, 0, 0, 5);
    expect(camera.x).toBeCloseTo(0, 9);
    expect(camera.z).toBeCloseTo(5, 9);
  });

  it('lowers the camera below the centre for a look-up pitch', () => {
    expect(orbitPosition(centre, 0, 0.4, 5).y).toBeCloseTo(-5 * Math.sin(0.4), 9);
  });
});
