import { useEffect } from 'react';
import { isHotkeyBlocked } from './isHotkeyBlocked';

export function useShortcutsHotkey(onOpen: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isHotkeyBlocked(e)) {
        return;
      }
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen, enabled]);
}
