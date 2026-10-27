import { useEffect } from 'react';
import { isTypingTarget } from '@officexr/world/react';

export function useShortcutsHotkey(onOpen: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) {
        return;
      }
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen, enabled]);
}
