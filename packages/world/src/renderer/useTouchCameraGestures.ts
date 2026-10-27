import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { CameraMode } from './config.ts';
import {
  applyLookDelta,
  applyZoom,
  isLookMode,
  pinchFactor,
  type LookRefs,
} from './lookControls.ts';

const TOUCH_SENSITIVITY = 0.005;

interface Point {
  x: number;
  y: number;
}

/**
 * One-finger drag looks around and a two-finger pinch zooms, on the canvas.
 * Mouse and pen pointers are ignored, and the events are not
 * `preventDefault`ed so the compatibility mousedown still reaches the focus
 * tracking. Does nothing in modes without look input.
 */
export function useTouchCameraGestures(mode: CameraMode, refs: LookRefs): void {
  const canvas = useThree((s) => s.gl.domElement);

  useEffect(() => {
    if (!isLookMode(mode)) {
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
        applyLookDelta(
          mode,
          -(next.x - prev.x) * TOUCH_SENSITIVITY,
          -(next.y - prev.y) * TOUCH_SENSITIVITY,
          refs,
        );
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

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onEnd);
    canvas.addEventListener('pointercancel', onEnd);
    // A released capture without a pointerup must not leave a stale pointer.
    canvas.addEventListener('lostpointercapture', onEnd);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
      canvas.removeEventListener('lostpointercapture', onEnd);
    };
  }, [mode, canvas, refs]);
}
