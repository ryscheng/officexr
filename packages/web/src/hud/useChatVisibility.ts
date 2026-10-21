import { useCallback, useEffect, useRef, useState } from 'react';

export const AUTO_HIDE_MS = 10_000;

/** `peek` shows the log without taking the keyboard; `compose` is the user typing. */
type ChatMode = { type: 'hidden' } | { type: 'peek' } | { type: 'compose' };

const HIDDEN: ChatMode = { type: 'hidden' };
const PEEK: ChatMode = { type: 'peek' };
const COMPOSE: ChatMode = { type: 'compose' };

/** Incoming messages only peek; composing starts from the user's own actions. */
export function useChatVisibility(messageCount: number) {
  const [mode, setMode] = useState<ChatMode>(HIDDEN);
  const seen = useRef(messageCount);

  useEffect(() => {
    if (messageCount !== seen.current) {
      seen.current = messageCount;
      setMode((m) => (m.type === 'hidden' ? PEEK : m));
    }
  }, [messageCount]);

  useEffect(() => {
    if (mode.type !== 'peek') {
      return;
    }
    const timer = setTimeout(() => setMode(HIDDEN), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [mode, messageCount]);

  return {
    mode: mode.type,
    compose: useCallback(() => setMode(COMPOSE), []),
    peek: useCallback(() => setMode(PEEK), []),
    hide: useCallback(() => setMode(HIDDEN), []),
  };
}
