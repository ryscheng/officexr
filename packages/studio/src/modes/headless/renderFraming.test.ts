import { describe, expect, it } from 'vitest';
import { boundsCentre, frameCamera, unionBounds, type Bounds, type CameraSetup } from './renderFraming.ts';
import type { Vec3 } from './renderParams.ts';

const SIZE = { width: 800, height: 600 };
const BOUNDS: Bounds = { min: [-3, 0, 2], max: [17, 4, 12] };

function corners({ min, max }: Bounds): Vec3[] {
  return [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z): Vec3 => [x, y, z])),
  );
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(...a);
  return [a[0] / len, a[1] / len, a[2] / len];
};

/** Camera-space coordinates of `point`: x right, y up, depth in front of the camera. */
function toCameraSpace(setup: CameraSetup, point: Vec3, up: Vec3 = [0, 1, 0]) {
  const forward = normalize(sub(setup.target, setup.position));
  const right = normalize(cross(forward, up));
  const trueUp = cross(right, forward);
  const rel = sub(point, setup.position);
  return { x: dot(rel, right), y: dot(rel, trueUp), depth: dot(rel, forward) };
}

describe('frameCamera top', () => {
  const setup = frameCamera({ type: 'top' }, BOUNDS, SIZE);

  it('is orthographic, looks straight down and is centred on the bounds', () => {
    if (setup.type !== 'orthographic') {
      throw new Error('expected orthographic');
    }
    expect(setup.position[0]).toBeCloseTo(boundsCentre(BOUNDS)[0]);
    expect(setup.position[2]).toBeCloseTo(boundsCentre(BOUNDS)[2]);
    expect(setup.target[0]).toBe(setup.position[0]);
    expect(setup.target[2]).toBe(setup.position[2]);
    expect(setup.position[1]).toBeGreaterThan(BOUNDS.max[1]);
  });

  it('contains every bounds corner in the view and the clip range', () => {
    if (setup.type !== 'orthographic') {
      throw new Error('expected orthographic');
    }
    const halfW = SIZE.width / setup.zoom / 2;
    const halfH = SIZE.height / setup.zoom / 2;
    for (const corner of corners(BOUNDS)) {
      const p = toCameraSpace(setup, corner, setup.up);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(halfW);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(halfH);
      expect(p.depth).toBeGreaterThan(setup.near);
      expect(p.depth).toBeLessThan(setup.far);
    }
  });

  it('reports metres per pixel matching the zoom, fitted to the tighter axis', () => {
    if (setup.type !== 'orthographic') {
      throw new Error('expected orthographic');
    }
    expect(setup.metresPerPixel).toBeCloseTo(1 / setup.zoom);
    // 20 m wide + margins fills the 800 px width; the 10 m depth leaves spare height.
    expect(setup.metresPerPixel).toBeCloseTo(22 / SIZE.width);
  });

  it('puts -Z at the top of the image', () => {
    if (setup.type !== 'orthographic') {
      throw new Error('expected orthographic');
    }
    const north = toCameraSpace(setup, [setup.target[0], 0, setup.target[2] - 5], setup.up);
    expect(north.y).toBeGreaterThan(0);
  });

  it('still reaches the y=0 grid when the scene floats above it', () => {
    const floating = frameCamera({ type: 'top' }, { min: [0, 20, 0], max: [4, 24, 4] }, SIZE);
    if (floating.type !== 'orthographic') {
      throw new Error('expected orthographic');
    }
    expect(floating.far).toBeGreaterThan(floating.position[1]);
  });
});

describe('frameCamera iso', () => {
  it.each([
    ['landscape', { width: 800, height: 600 }],
    ['portrait', { width: 300, height: 900 }],
  ])('keeps every bounds corner inside the %s frustum', (_label, size) => {
    const setup = frameCamera({ type: 'iso' }, BOUNDS, size);
    if (setup.type !== 'perspective') {
      throw new Error('expected perspective');
    }
    const tanV = Math.tan((setup.fov * Math.PI) / 360);
    const tanH = tanV * (size.width / size.height);
    for (const corner of corners(BOUNDS)) {
      const p = toCameraSpace(setup, corner);
      expect(p.depth).toBeGreaterThan(setup.near);
      expect(p.depth).toBeLessThan(setup.far);
      expect(Math.abs(p.x) / p.depth).toBeLessThan(tanH);
      expect(Math.abs(p.y) / p.depth).toBeLessThan(tanV);
    }
  });

  it('looks at the bounds centre from above', () => {
    const setup = frameCamera({ type: 'iso' }, BOUNDS, SIZE);
    expect(setup.target).toEqual(boundsCentre(BOUNDS));
    expect(setup.position[1]).toBeGreaterThan(BOUNDS.max[1]);
  });
});

describe('frameCamera custom', () => {
  it('uses the given position and target', () => {
    const setup = frameCamera({ type: 'custom', position: [1, 2, 3], target: [4, 5, 6] }, BOUNDS, SIZE);
    expect(setup).toMatchObject({ type: 'perspective', position: [1, 2, 3], target: [4, 5, 6] });
  });

  it('looks at the bounds centre without a target', () => {
    const setup = frameCamera({ type: 'custom', position: [1, 2, 3] }, BOUNDS, SIZE);
    expect(setup.target).toEqual(boundsCentre(BOUNDS));
  });
});

describe('unionBounds', () => {
  it('unions the boxes and is null for nothing', () => {
    const boxes: Bounds[] = [
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [-2, 0.5, 3], max: [0, 4, 5] },
    ];
    expect(unionBounds(boxes, (b) => b)).toEqual({ min: [-2, 0, 0], max: [1, 4, 5] });
    expect(unionBounds([], (b: Bounds) => b)).toBeNull();
  });
});
