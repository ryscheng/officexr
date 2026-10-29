import { useEffect, useEffectEvent } from 'react';
import { useThree } from '@react-three/fiber';
import type { CameraMode } from './config.ts';
import {
  applyLookDelta,
  applyZoom,
  isLookMode,
  pinchFactor,
  wheelZoomFactor,
  type LookRefs,
} from './lookControls.ts';

const TOUCH_SENSITIVITY = 0.005;

interface Point {
  x: number;
  y: number;
}

/** Binds `useCanvasGestures` to the R3F canvas. */
export function useTouchCameraGestures(
  mode: CameraMode,
  refs: LookRefs,
  lookSign = -1,
  paused = false,
): void {
  const canvas = useThree((s) => s.gl.domElement);
  useCanvasGestures(canvas, mode, refs, lookSign, paused);
}

/**
 * One-finger drag looks around and a two-finger pinch zooms, on the canvas.
 * Mouse and pen pointers are ignored by the touch gestures, and their events
 * are not `preventDefault`ed so the compatibility mousedown still reaches the
 * focus tracking. The mouse wheel zooms and is `preventDefault`ed so the page
 * doesn't scroll. Does nothing in modes without look input, and a paused scene
 * ignores all of these touch and wheel gestures. `lookSign` flips the drag
 * look direction only, never the zoom.
 */
export function useCanvasGestures(
  canvas: HTMLElement,
  mode: CameraMode,
  refs: LookRefs,
  lookSign: number,
  paused: boolean,
): void {
  const onDragLook = useEffectEvent((dx: number, dy: number) =>
    applyLookDelta(mode, lookSign * dx * TOUCH_SENSITIVITY, lookSign * dy * TOUCH_SENSITIVITY, refs),
  );

  useEffect(() => {
    if (!isLookMode(mode) || paused) {
      return;
    }
    const pointers = new Map<number, Point>();

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        return;
      }
      const next = { x: e.clientX, y: e.clientY };
      if (pointers.size === 1) {
        onDragLook(next.x - prev.x, next.y - prev.y);
      } else if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        applyZoom(
          pinchFactor(
            Math.hypot(prev.x - other.x, prev.y - other.y),
            Math.hypot(next.x - other.x, next.y - other.y),
          ),
          refs.viewOffsetsRef.current,
        );
      }
      pointers.set(e.pointerId, next);
    };
    const onEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), refs.viewOffsetsRef.current);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onEnd);
    canvas.addEventListener('pointercancel', onEnd);
    // A released capture without a pointerup must not leave a stale pointer.
    canvas.addEventListener('lostpointercapture', onEnd);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
      canvas.removeEventListener('lostpointercapture', onEnd);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [mode, canvas, refs, paused]);
}
