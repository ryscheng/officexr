import { useEffect, useRef } from 'react';
import { focusWorld, useWorldFocus } from '@officexr/world/top-down';
import { isHotkeyBlocked } from './isHotkeyBlocked';

const MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

const isMovementPress = (e: KeyboardEvent) =>
  MOVEMENT_KEYS.has(e.key.toLowerCase()) &&
  !(e.altKey || e.ctrlKey || e.metaKey) &&
  !(e.target instanceof HTMLSelectElement) &&
  !isHotkeyBlocked(e, '[data-map-dialog]');

/**
 * Hands the keyboard back to the world when a movement key is pressed while it is released, and replays
 * that press once the world listens, which it only does after React has committed the focus change.
 */
export function useRefocusOnMovementKey(): void {
  const focused = useWorldFocus();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const pending = useRef<{ key: string; code: string } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (focusedRef.current || pending.current || !isMovementPress(e)) {
        return;
      }
      pending.current = { key: e.key, code: e.code };
      focusWorld();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (pending.current?.key.toLowerCase() === e.key.toLowerCase()) {
        pending.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  useEffect(() => {
    if (!focused || !pending.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const press = pending.current;
      pending.current = null;
      if (press) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: press.key, code: press.code, bubbles: true }));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focused]);
}

export function RefocusOnMovementKey() {
  useRefocusOnMovementKey();
  return null;
}
