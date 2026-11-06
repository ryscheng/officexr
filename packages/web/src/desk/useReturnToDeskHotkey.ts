import { useEffect } from 'react';
import { isTypingTarget } from '@officexr/world/top-down';

export function useReturnToDeskHotkey(onReturn: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyD' || isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) {
        return;
      }
      e.preventDefault();
      onReturn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onReturn]);
}
