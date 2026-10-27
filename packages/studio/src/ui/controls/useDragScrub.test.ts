/**
 * useDragScrub regressions. Drives the hook through a fake pointer
 * lifecycle and asserts:
 *   - dx * step is added to the start value
 *   - shift / alt modifiers multiply the dx delta
 *   - bounds (min, max) clamp the emitted value
 *   - pointercancel ends the drag
 *   - unmount mid-drag cleans up the window listeners
 *
 * The hook is exercised via @testing-library/react's renderHook.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDragScrub } from './useDragScrub.ts';

// jsdom (vitest's DOM) doesn't ship PointerEvent. We construct a
// plain Event with the properties the hook reads — clientX, button,
// shiftKey, altKey — and cast to PointerEvent for the type. This is
// safe because the hook is duck-typed against those four properties.
function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  opts: { clientX?: number; shiftKey?: boolean; altKey?: boolean } = {},
): PointerEvent {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'clientX', { value: opts.clientX ?? 0 });
  Object.defineProperty(e, 'clientY', { value: 0 });
  Object.defineProperty(e, 'button', { value: 0 });
  Object.defineProperty(e, 'shiftKey', { value: opts.shiftKey ?? false });
  Object.defineProperty(e, 'altKey', { value: opts.altKey ?? false });
  return e as unknown as PointerEvent;
}

function startDrag(
  onPointerDown: (e: PointerEvent) => void,
  startX: number,
) {
  // We can't dispatch on the element directly via the hook's
  // returned onPointerDown — call it as if React forwarded the event.
  onPointerDown(pointerEvent('pointerdown', { clientX: startX }));
}

afterEach(() => {
  // Ensure the cursor reset between tests so a failing test doesn't
  // bleed cursor: ew-resize into subsequent ones.
  document.body.style.cursor = '';
});

describe('useDragScrub', () => {
  it('emits start + dx*step on pointermove', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 10, step: 0.5, onChange }),
    );
    startDrag(result.current.onPointerDown, 100);
    expect(result.current.isDragging()).toBe(true);

    // dx = +20 px → +20 * 0.5 = +10. start was 10 → 20.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 120 }));
    expect(onChange).toHaveBeenCalledWith(20);

    // dx = -10 px → -10 * 0.5 = -5. start (still 10) → 5.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 90 }));
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it('shift multiplies the delta by 10', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 0, step: 1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    // dx = 1 px with shift → 1 * 1 * 10 = 10.
    window.dispatchEvent(
      pointerEvent('pointermove', { clientX: 1, shiftKey: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('alt multiplies the delta by 0.1', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 0, step: 1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    // dx = 10 px with alt → 10 * 1 * 0.1 = 1.
    window.dispatchEvent(
      pointerEvent('pointermove', { clientX: 10, altKey: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps to min/max bounds', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 5, step: 1, min: 0, max: 10, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    // dx = 100 → would be 105 → clamped to 10.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 100 }));
    expect(onChange).toHaveBeenLastCalledWith(10);
    // dx = -100 → would be -95 → clamped to 0.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: -100 }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('snaps to step grid relative to start value', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 0, step: 0.1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    // dx = 23 → raw = 2.3 → step grid (0.1) snaps to 2.3 exactly.
    // dx = 24 → 2.4. dx = 23.4 → 2.34 → snaps to 2.3.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 23 }));
    expect(onChange.mock.calls.at(-1)?.[0]).toBeCloseTo(2.3, 10);
  });

  it('pointercancel ends the drag', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 0, step: 1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    expect(result.current.isDragging()).toBe(true);
    window.dispatchEvent(pointerEvent('pointercancel'));
    expect(result.current.isDragging()).toBe(false);
    // Subsequent moves are ignored.
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 100 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pointerup ends the drag and clears body cursor', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDragScrub({ value: 0, step: 1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    expect(document.body.style.cursor).toBe('ew-resize');
    window.dispatchEvent(pointerEvent('pointerup'));
    expect(result.current.isDragging()).toBe(false);
    expect(document.body.style.cursor).toBe('');
  });

  it('unmount cleans up window listeners mid-drag', () => {
    const onChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDragScrub({ value: 0, step: 1, onChange }),
    );
    startDrag(result.current.onPointerDown, 0);
    unmount();
    // After unmount, future pointermoves on the window must not
    // fire onChange (the hook's listener should have been removed).
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 50 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
