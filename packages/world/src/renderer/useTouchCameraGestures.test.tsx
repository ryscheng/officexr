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
  const hook = renderHook(
    (props: { mode: CameraMode; paused: boolean }) =>
      useCanvasGestures(canvas, props.mode, refs, -1, props.paused),
    { initialProps: { mode, paused } },
  );
  const update = (next: Partial<{ mode: CameraMode; paused: boolean }>) =>
    hook.rerender({ mode, paused, ...next });
  const wheel = (deltaY: number, ctrlKey = false) => {
    const e = new WheelEvent('wheel', { deltaY, ctrlKey, cancelable: true });
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
  return { refs, wheel, pinchOut, update };
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

  it('zooms faster for a trackpad pinch (ctrl+wheel) than for a plain wheel', () => {
    const plain = mount('fixed');
    plain.wheel(-5);
    const pinch = mount('fixed');
    pinch.wheel(-5, true);
    expect(pinch.refs.viewOffsetsRef.current.zoom).toBeGreaterThan(
      plain.refs.viewOffsetsRef.current.zoom,
    );
  });

  it('removes the wheel listener when the scene becomes paused', () => {
    const { refs, wheel, update } = mount('fixed');
    update({ paused: true });
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(refs.viewOffsetsRef.current.zoom).toBe(1);
  });

  it('removes the wheel listener when the mode switches to free-fly', () => {
    const { refs, wheel, update } = mount('fixed');
    update({ mode: 'free-fly' });
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(refs.viewOffsetsRef.current.zoom).toBe(1);
  });

  it('still pinch-zooms when not paused', () => {
    const { refs, pinchOut } = mount('fixed');
    pinchOut();
    expect(refs.viewOffsetsRef.current.zoom).toBeGreaterThan(1);
  });
});
