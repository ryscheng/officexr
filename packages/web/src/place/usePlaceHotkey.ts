import { useEffect } from 'react';
import type { PlaceModeStore } from '@officexr/world/motion';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';

export function usePlaceHotkey(mode: PlaceModeStore, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'b' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isHotkeyBlocked(e)) {
        return;
      }
      mode.setOpen(!mode.get().open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, enabled]);
}
