import { useEffect } from 'react';

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** Calls `onOpen` on `?`, unless the user is typing or a dialog is already open. */
export function useShortcutsHotkey(onOpen: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target) || document.querySelector('[role="dialog"]')) {
        return;
      }
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen, enabled]);
}
