// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CameraMode } from './config.ts';
import { DEG2RAD, type LookRefs } from './lookControls.ts';
import type { MotionLookState } from './motionLook.ts';
import { useMotionLook } from './useMotionLook.ts';

afterEach(cleanup);

const makeRefs = (): LookRefs => ({
  yawRef: { current: 0.5 },
  pitchRef: { current: -0.25 },
  viewOffsetsRef: { current: { fixedAzimuthOffsetRad: 0.1, fixedPitchOffsetRad: 0.2, zoom: 1 } },
});

/** An upright device whose back camera points `turnDeg` left of north and `upDeg` above the horizon. */
const orient = (turnDeg: number, upDeg = 0) =>
  act(() => {
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: turnDeg, beta: 90 + upDeg, gamma: 0 }));
  });

function mount(motionLook: MotionLookState, mode: CameraMode = 'first-person') {
  const refs = makeRefs();
  const hook = renderHook((props: { motionLook: MotionLookState; mode: CameraMode }) => useMotionLook(props.motionLook, props.mode, refs), {
    initialProps: { motionLook, mode },
  });
  const update = (next: Partial<{ motionLook: MotionLookState; mode: CameraMode }>) =>
    hook.rerender({ motionLook, mode, ...next });
  return { refs, update };
}

describe('useMotionLook', () => {
  it('treats the first reading as the baseline, then applies each delta on top of the view', () => {
    const { refs } = mount({ enabled: true, recenterKey: 0 });
    orient(20);
    expect(refs.yawRef.current).toBeCloseTo(0.5);
    orient(30, 5);
    expect(refs.yawRef.current).toBeCloseTo(0.5 + 10 * DEG2RAD);
    expect(refs.pitchRef.current).toBeCloseTo(-0.25 + 5 * DEG2RAD);
  });

  it('steers the fixed-camera offsets in fixed mode', () => {
    const { refs } = mount({ enabled: true, recenterKey: 0 }, 'fixed');
    orient(0);
    orient(10);
    expect(refs.viewOffsetsRef.current.fixedAzimuthOffsetRad).toBeCloseTo(0.1 - 10 * DEG2RAD);
    expect(refs.yawRef.current).toBe(0.5);
  });

  it('does nothing while off, and snapshots the view only once enabled', () => {
    const { refs, update } = mount({ enabled: false, recenterKey: 0 });
    orient(0);
    orient(10);
    expect(refs.yawRef.current).toBe(0.5);
    refs.yawRef.current = 1;
    update({ motionLook: { enabled: true, recenterKey: 0 } });
    orient(0);
    orient(10);
    update({ motionLook: { enabled: true, recenterKey: 1 } });
    expect(refs.yawRef.current).toBe(1);
  });

  it('restores the snapshot on recenter and takes the next reading as the new neutral', () => {
    const { refs, update } = mount({ enabled: true, recenterKey: 0 });
    orient(0);
    orient(10);
    refs.viewOffsetsRef.current.fixedAzimuthOffsetRad = 9;
    refs.viewOffsetsRef.current.fixedPitchOffsetRad = 9;
    refs.pitchRef.current = 0.9;
    update({ motionLook: { enabled: true, recenterKey: 1 } });
    expect(refs.yawRef.current).toBe(0.5);
    expect(refs.pitchRef.current).toBe(-0.25);
    expect(refs.viewOffsetsRef.current).toEqual({ fixedAzimuthOffsetRad: 0.1, fixedPitchOffsetRad: 0.2, zoom: 1 });
    orient(90);
    expect(refs.yawRef.current).toBe(0.5);
    orient(95);
    expect(refs.yawRef.current).toBeCloseTo(0.5 + 5 * DEG2RAD);
  });

  it('stops listening when turned off', () => {
    const { refs, update } = mount({ enabled: true, recenterKey: 0 });
    orient(0);
    update({ motionLook: { enabled: false, recenterKey: 0 } });
    orient(10);
    expect(refs.yawRef.current).toBe(0.5);
  });
});
