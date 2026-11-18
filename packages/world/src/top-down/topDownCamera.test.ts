import { describe, expect, it, vi } from 'vitest';
import { TopDownCameraController } from './cameraControls.tsx';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  cameraTransform,
  clampToBounds,
  followStep,
  panBy,
  visibleBounds,
  zoomBy,
  zoomLimits,
  type CameraState,
} from './topDownCamera.ts';
import { screenToWorld, worldToScreen } from './topDownGeometry.ts';

const size = { width: 400, height: 300 };
const free: CameraState = { centre: { x: 10, z: 5 }, zoom: 40, following: false };

describe('topDownCamera', () => {
  it('puts the centre in the middle of the screen at the zoom', () => {
    const t = cameraTransform(free, size);
    expect(worldToScreen(t, free.centre)).toEqual({ x: 200, y: 150 });
    expect(worldToScreen(t, { x: 11, z: 5 }).x).toBe(240);
  });

  it('zooms out as far as the whole map, in to the cap', () => {
    const big = { min: { x: 0, z: 0 }, max: { x: 100, z: 100 } };
    const limits = zoomLimits(big, size);
    expect(limits.min).toBeLessThan(DEFAULT_ZOOM);
    expect(limits.max).toBe(MAX_ZOOM);
    // A map smaller than the screen never forces a zoom-in past the default.
    expect(zoomLimits({ min: { x: 0, z: 0 }, max: { x: 1, z: 1 } }, size).min).toBe(DEFAULT_ZOOM);
  });

  it('keeps the world point under the pointer still when zooming a free camera', () => {
    const anchor = { x: 320, y: 60 };
    const before = screenToWorld(cameraTransform(free, size), anchor);
    const zoomed = zoomBy(free, 2, { min: 10, max: 200 }, size, anchor);
    const after = screenToWorld(cameraTransform(zoomed, size), anchor);
    expect(zoomed.zoom).toBe(80);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
  });

  it('zooms a following camera about you, and clamps to the limits', () => {
    const following = { ...free, following: true };
    expect(zoomBy(following, 100, { min: 10, max: 120 }, size, { x: 0, y: 0 })).toEqual({ ...following, zoom: 120 });
  });

  it('stops following on a pan and moves against the drag', () => {
    const panned = panBy({ ...free, following: true }, 40, 0);
    expect(panned.following).toBe(false);
    expect(panned.centre).toEqual({ x: 9, z: 5 });
  });

  it('eases towards the target only while following', () => {
    const target = { x: 20, z: 5 };
    expect(followStep(free, target, 0.1)).toBe(free);
    const step = followStep({ ...free, following: true }, target, 0.1);
    expect(step.centre.x).toBeGreaterThan(10);
    expect(step.centre.x).toBeLessThan(20);
  });

  it('keeps the centre over the map', () => {
    const bounds = { min: { x: 0, z: 0 }, max: { x: 8, z: 8 } };
    expect(clampToBounds(free, bounds).centre).toEqual({ x: 8, z: 5 });
    expect(clampToBounds(free, null)).toBe(free);
  });

  it('reports the visible world rectangle', () => {
    expect(visibleBounds(cameraTransform(free, size), size)).toEqual({ min: { x: 5, z: 1.25 }, max: { x: 15, z: 8.75 } });
  });
});

describe('TopDownCameraController', () => {
  it('jumps to you on the first track, then follows smoothly', () => {
    const camera = new TopDownCameraController();
    camera.track({ x: 30, z: -4 }, 0.016);
    expect(camera.state.centre).toEqual({ x: 30, z: -4 });
    camera.track({ x: 40, z: -4 }, 0.016);
    expect(camera.state.centre.x).toBeGreaterThan(30);
    expect(camera.state.centre.x).toBeLessThan(40);
  });

  it('tells the HUD only when a button would change, not on every frame', () => {
    const camera = new TopDownCameraController();
    const listener = vi.fn();
    camera.subscribe(listener);
    camera.setViewport({ min: 20, max: 100 }, size);
    expect(camera.getSnapshot()).toEqual({ canZoomIn: true, canZoomOut: true, following: true });
    listener.mockClear();
    camera.track({ x: 1, z: 1 }, 0.016);
    camera.track({ x: 2, z: 1 }, 0.016);
    expect(listener).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) {
      camera.zoomIn();
    }
    expect(camera.getSnapshot().canZoomIn).toBe(false);
    camera.pan(10, 0, null);
    expect(camera.getSnapshot().following).toBe(false);
    camera.recentre();
    expect(camera.getSnapshot().following).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
