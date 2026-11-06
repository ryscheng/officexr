import { isTypingTarget } from '@officexr/world/top-down';

/** Whether a shortcut should stand down: the key is going into a text field, or a dialog is open. */
export const isHotkeyBlocked = (e: KeyboardEvent) => isTypingTarget(e.target) || document.querySelector('[role="dialog"]') !== null;
