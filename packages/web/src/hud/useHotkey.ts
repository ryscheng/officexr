import { useEffect, useRef } from 'react';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

export function useHotkey(key: string, onPress: () => void, enabled = true, overDialog = '') {
  const latest = useRef(onPress);
  latest.current = onPress;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isHotkeyBlocked(e, overDialog) || (e.target instanceof Element && e.target.closest('[data-no-hotkeys]'))) {
        return;
      }
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled, overDialog]);
}
