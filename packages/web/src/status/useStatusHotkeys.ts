import { useEffect } from 'react';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

export interface StatusHotkeyActions {
  toggleHand(): void;
  toggleFocus(): void;
}

export function useStatusHotkeys(actions: StatusHotkeyActions, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.isComposing || isHotkeyBlocked(e)) {
        return;
      }
      const run =
        e.altKey && e.code === 'KeyN'
          ? actions.toggleFocus
          : !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h'
            ? actions.toggleHand
            : null;
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, enabled]);
}
