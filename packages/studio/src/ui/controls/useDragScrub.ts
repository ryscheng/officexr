import { useCallback, useEffect, useRef } from 'react';

export interface UseDragScrubOpts {
  /** Current value at drag-start. Captured into a ref on pointer-down
   *  so the running drag operates against a stable baseline. */
  value: number;
  /** Per-pixel increment. Leva uses (max-min)/200 by default for
   *  bounded ranges, or `step` for unbounded; we match that
   *  heuristic in `NumberInput`. */
  step: number;
  /** Optional inclusive bounds. Either or both may be undefined; the
   *  hook only clamps when bounds are provided. */
  min?: number;
  max?: number;
  /** Called every pointermove tick with the new value. The caller is
   *  responsible for not re-rendering the world if the value didn't
   *  change — `NumberInput` does a `prev === next` guard. */
  onChange: (next: number) => void;
  /** Optional rounding granularity. `step` is used by default — but
   *  some callers (e.g. integer voxel coords) want a coarser `round`
   *  even when the step is 1. Defaults to `step`. */
  round?: number;
}

export interface UseDragScrubResult {
  /** Attach to the drag-handle element. Pointer-down starts a drag,
   *  subsequent pointermove/up listeners are window-level so the
   *  drag continues even when the cursor leaves the element. */
  onPointerDown: (e: React.PointerEvent | PointerEvent) => void;
  /** True while a drag is in flight. The caller can show an active
   *  cursor (`cursor: ew-resize`) and skip click-to-edit transitions
   *  while dragging. */
  isDragging: () => boolean;
}

/**
 * Leva-style drag-to-scrub on a numeric input. Pointer-down captures
 * the pointer and the running cursor for the duration of the drag;
 * horizontal pixel delta times `step` (with modifiers) is added to
 * the captured start value and emitted via `onChange`.
 *
 * Modifiers (match Leva's behaviour so users don't relearn):
 *   - Shift held while dragging → multiplier ×10 (coarse).
 *   - Alt held while dragging   → multiplier ×0.1 (fine).
 *
 * Cleanup: pointerup, pointercancel, and visibilitychange all end
 * the drag. An unmount during a drag also cleans up the window
 * listeners.
 *
 * Why a ref-based start: pulling `value`/`min`/`max` from the latest
 * props at pointermove time would feed the in-flight drag back into
 * itself (each tick's emitted value becomes the next tick's base),
 * causing acceleration. Snapshot-at-pointer-down avoids that.
 */
export function useDragScrub(opts: UseDragScrubOpts): UseDragScrubResult {
  // Live opts ref so the pointermove closure reads the latest
  // step/min/max/onChange without re-binding event listeners.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  // Drag state. Kept in refs so pointermove doesn't trigger renders.
  const drag = useRef<{
    active: boolean;
    startX: number;
    startValue: number;
  }>({ active: false, startX: 0, startValue: 0 });

  const endDrag = useCallback(() => {
    drag.current.active = false;
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMoveRef.current!);
    window.removeEventListener('pointerup', onPointerUpRef.current!);
    window.removeEventListener('pointercancel', onPointerUpRef.current!);
    document.removeEventListener('visibilitychange', onVisibilityRef.current!);
  }, []);

  // Reuse listener identities so removeEventListener actually
  // removes them.
  const onPointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onPointerUpRef = useRef<(() => void) | null>(null);
  const onVisibilityRef = useRef<(() => void) | null>(null);

  onPointerMoveRef.current = (e: PointerEvent) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    const { step, min, max, onChange, round } = optsRef.current;
    let multiplier = 1;
    if (e.shiftKey) multiplier *= 10;
    if (e.altKey) multiplier *= 0.1;
    const granularity = round ?? step;
    let next = drag.current.startValue + dx * step * multiplier;
    // Snap to step grid relative to the start value so coarse steps
    // produce predictable values (e.g. step=1 yields integers).
    next = Math.round(next / granularity) * granularity;
    if (typeof min === 'number') next = Math.max(min, next);
    if (typeof max === 'number') next = Math.min(max, next);
    onChange(next);
  };

  onPointerUpRef.current = () => endDrag();
  onVisibilityRef.current = () => {
    if (document.hidden) endDrag();
  };

  useEffect(() => {
    // Cleanup on unmount in case a drag was in flight.
    return () => {
      if (drag.current.active) endDrag();
    };
  }, [endDrag]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      // Only left-button drags. (Right-button is reserved for
      // context menus by every other tool in the studio.)
      if ('button' in e && e.button !== 0) return;
      e.preventDefault();
      drag.current = {
        active: true,
        startX: e.clientX,
        startValue: optsRef.current.value,
      };
      document.body.style.cursor = 'ew-resize';
      window.addEventListener('pointermove', onPointerMoveRef.current!);
      window.addEventListener('pointerup', onPointerUpRef.current!);
      window.addEventListener('pointercancel', onPointerUpRef.current!);
      document.addEventListener('visibilitychange', onVisibilityRef.current!);
    },
    [],
  );

  const isDragging = useCallback(() => drag.current.active, []);

  return { onPointerDown, isDragging };
}
