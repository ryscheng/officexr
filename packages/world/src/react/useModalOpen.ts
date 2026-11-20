import { useEffect, useState } from 'react';
import { isTypingTarget } from './useWorldFocus.ts';

const modalOpen = () => document.querySelector('[role="dialog"]') !== null || isTypingTarget(document.activeElement);

/** Whether a dialog is open or a text field has focus, so on-screen game buttons should stand down. */
export function useModalOpen(): boolean {
  const [open, setOpen] = useState(modalOpen);
  useEffect(() => {
    const update = () => setOpen(modalOpen());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}
