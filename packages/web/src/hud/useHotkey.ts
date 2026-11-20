import { useEffect, useRef } from 'react';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

/** Runs `onPress` for an unmodified press of `key` while `enabled`, unless a text field or dialog has the keyboard. */
export function useHotkey(key: string, onPress: () => void, enabled = true) {
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isHotkeyBlocked(e)) {
        return;
      }
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled]);
}
