import { useLayoutEffect, useRef } from 'react';
import { escapeStack, type EscapeLayer, type EscapeStack } from './escapeStack';

/** While `active`, this overlay is on the Esc stack and `onEscape` runs when it is the topmost. */
export function useEscapeLayer(
  active: boolean,
  onEscape: () => void,
  owns?: EscapeLayer['owns'],
  stack: EscapeStack = escapeStack,
) {
  const latest = useRef({ onEscape, owns });
  latest.current = { onEscape, owns };
  // Registered at commit, not after paint, so an Esc pressed the moment the overlay appears still finds it.
  useLayoutEffect(
    () =>
      active
        ? stack.push({ onEscape: () => latest.current.onEscape(), owns: () => latest.current.owns?.() ?? null })
        : undefined,
    [active, stack],
  );
}

/** Runs `onEscape` when Esc finds no open overlay and the mouse is free. */
export function useEscapeFallback(onEscape: () => void, enabled = true, stack: EscapeStack = escapeStack) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useLayoutEffect(() => (enabled ? stack.setFallback(() => latest.current()) : undefined), [enabled, stack]);
}
