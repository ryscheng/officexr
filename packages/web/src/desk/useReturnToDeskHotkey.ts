import { useEffect } from 'react';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

export function useReturnToDeskHotkey(onReturn: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyD' || e.repeat || isHotkeyBlocked(e)) {
        return;
      }
      e.preventDefault();
      onReturn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onReturn]);
}
