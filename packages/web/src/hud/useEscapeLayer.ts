import { useEffect, useRef } from 'react';
import { escapeStack, type EscapeStack } from './escapeStack';

/** While `active`, this overlay is on the Esc stack and `onEscape` runs when it is the topmost. */
export function useEscapeLayer(
  active: boolean,
  onEscape: () => void,
  ownsTyping = false,
  stack: EscapeStack = escapeStack,
) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(
    () => (active ? stack.push({ onEscape: () => latest.current(), ownsTyping }) : undefined),
    [active, ownsTyping, stack],
  );
}

/** Runs `onEscape` when Esc finds no open overlay and the mouse is free. */
export function useEscapeFallback(onEscape: () => void, enabled = true, stack: EscapeStack = escapeStack) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    stack.setFallback(onEscape);
    return () => stack.setFallback(null);
  }, [onEscape, enabled, stack]);
}
