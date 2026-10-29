// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraMode } from './config.ts';
import type { LookRefs } from './lookControls.ts';
import { useCanvasGestures } from './useTouchCameraGestures.ts';

afterEach(cleanup);

const makeRefs = (): LookRefs => ({
  yawRef: { current: 0 },
  pitchRef: { current: 0 },
  viewOffsetsRef: { current: { fixedAzimuthOffsetRad: 0, fixedPitchOffsetRad: 0, zoom: 1 } },
});

function mount(mode: CameraMode, paused = false) {
  const canvas = document.createElement('canvas');
  const refs = makeRefs();
  renderHook(() => useCanvasGestures(canvas, mode, refs, -1, paused));
  const wheel = (deltaY: number) => {
    const e = new WheelEvent('wheel', { deltaY, cancelable: true });
    canvas.dispatchEvent(e);
    return e;
  };
  const touch = (id: number, type: string, x: number) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), { pointerId: id, pointerType: 'touch', clientX: x, clientY: 0 }),
    );
  const pinchOut = () => {
    touch(1, 'pointerdown', 100);
    touch(2, 'pointerdown', 200);
    touch(1, 'pointermove', 50);
  };
  return { refs, wheel, pinchOut };
}

describe('useCanvasGestures', () => {
  it.each<CameraMode>(['first-person', 'third-person', 'fixed'])(
    'zooms with the wheel in %s and keeps the page from scrolling',
    (mode) => {
      const { refs, wheel } = mount(mode);
      const up = wheel(-100);
      expect(up.defaultPrevented).toBe(true);
      expect(refs.viewOffsetsRef.current.zoom).toBeGreaterThan(1);
      wheel(200);
      expect(refs.viewOffsetsRef.current.zoom).toBeLessThan(1);
    },
  );

  it('ignores the wheel outside the look modes', () => {
    const { refs, wheel } = mount('free-fly');
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(refs.viewOffsetsRef.current.zoom).toBe(1);
  });

  it('changes the zoom on neither wheel nor pinch while paused', () => {
    const { refs, wheel, pinchOut } = mount('fixed', true);
    expect(wheel(-100).defaultPrevented).toBe(false);
    pinchOut();
    expect(refs.viewOffsetsRef.current.zoom).toBe(1);
  });

  it('still pinch-zooms when not paused', () => {
    const { refs, pinchOut } = mount('fixed');
    pinchOut();
    expect(refs.viewOffsetsRef.current.zoom).toBeGreaterThan(1);
  });
});
