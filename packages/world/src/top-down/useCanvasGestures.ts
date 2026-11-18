import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { ScreenPoint } from './topDownGeometry.ts';

/** What the 2D canvas does with each gesture. Must be stable (memoised): the wheel listener keeps the first one. */
export interface CanvasGestureHandlers {
  /** A click or tap that didn't turn into a drag. */
  onTap(point: ScreenPoint): void;
  /** The mouse moved over the canvas without a button held (null when it left). */
  onHover(point: ScreenPoint | null, relatedTarget: EventTarget | null): void;
  onPan(dx: number, dy: number): void;
  /** Zoom by `factor` about `anchor` (wheel, trackpad pinch or two-finger pinch). */
  onZoom(factor: number, anchor: ScreenPoint): void;
}

/** A press that travels further than this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 5;
/** Wheel notches zoom gently; trackpad pinches (ctrl+wheel) report small deltas, so they scale up. */
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_ZOOM_RATE = 0.01;

function localPoint(canvas: HTMLElement, clientX: number, clientY: number): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Pan by dragging, zoom by wheel or pinch, move by clicking. Returns the props for the
 * canvas element; the wheel is attached natively because React's listener is passive.
 */
export function useCanvasGestures(canvasRef: RefObject<HTMLCanvasElement | null>, handlers: CanvasGestureHandlers) {
  const pointers = useRef(new Map<number, ScreenPoint>());
  const pressedAt = useRef<ScreenPoint | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rate = e.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      // deltaMode 1 is lines (Firefox); treat one line as ~16 pixels.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      handlers.onZoom(Math.exp(-delta * rate), localPoint(canvas, e.clientX, e.clientY));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef, handlers]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    const p = localPoint(e.currentTarget, e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      pressedAt.current = p;
      dragged.current = false;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      return;
    }
    const p = localPoint(e.currentTarget, e.clientX, e.clientY);
    const other = [...pointers.current].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      // Pinch: zoom by the change in finger spread, about the fingers' midpoint.
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      if (before > 0 && after > 0) {
        handlers.onZoom(after / before, { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 });
      }
      dragged.current = true;
    } else {
      const start = pressedAt.current;
      if (!dragged.current && start && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_THRESHOLD_PX) {
        dragged.current = true;
      }
      if (dragged.current) {
        handlers.onPan(p.x - prev.x, p.y - prev.y);
      }
    }
    pointers.current.set(e.pointerId, p);
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (pointers.current.size === 0) {
      handlers.onHover(localPoint(e.currentTarget, e.clientX, e.clientY), null);
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      pressedAt.current = null;
    }
  };

  const onClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    // The click that ends a drag or pinch is not a move.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    handlers.onTap(localPoint(e.currentTarget, e.clientX, e.clientY));
  };

  const onMouseLeave = (e: ReactMouseEvent<HTMLCanvasElement>) => handlers.onHover(null, e.relatedTarget);

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClick, onMouseMove, onMouseLeave };
}
