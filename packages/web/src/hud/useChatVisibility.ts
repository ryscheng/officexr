import { useCallback, useEffect, useRef, useState } from 'react';
import { useFold, type FoldStorage } from './foldPrefs';

export const AUTO_HIDE_MS = 10_000;

type ChatMode = { type: 'hidden' } | { type: 'peek' } | { type: 'compose' };

const HIDDEN: ChatMode = { type: 'hidden' };
const PEEK: ChatMode = { type: 'peek' };
const COMPOSE: ChatMode = { type: 'compose' };

export type ChatVisibilityOptions = {
  defaultFolded?: boolean;
  peekMs?: number;
  storage?: FoldStorage;
};

/**
 * Folded means the user put the chat away: a new message only adds to the unread count.
 * Opening it again (`compose`) unfolds it, so later messages peek.
 */
export function useChatVisibility(messageCount: number, { defaultFolded = false, peekMs = AUTO_HIDE_MS, storage }: ChatVisibilityOptions = {}) {
  const [mode, setMode] = useState<ChatMode>(HIDDEN);
  const fold = useFold('chat', defaultFolded, storage);
  const { folded, setFolded } = fold;
  const seen = useRef(messageCount);

  useEffect(() => {
    if (messageCount !== seen.current) {
      seen.current = messageCount;
      if (!folded) {
        setMode((m) => (m.type === 'hidden' ? PEEK : m));
      }
    }
  }, [messageCount, folded]);

  useEffect(() => {
    if (mode.type !== 'peek') {
      return;
    }
    const timer = setTimeout(() => setMode(HIDDEN), peekMs);
    return () => clearTimeout(timer);
  }, [mode, messageCount, peekMs]);

  return {
    mode: mode.type,
    folded,
    compose: useCallback(() => {
      setFolded(false);
      setMode(COMPOSE);
    }, [setFolded]),
    peek: useCallback(() => setMode(PEEK), []),
    hide: useCallback(() => setMode(HIDDEN), []),
    collapse: useCallback(() => {
      setFolded(true);
      setMode(HIDDEN);
    }, [setFolded]),
  };
}

export type ChatVisibility = ReturnType<typeof useChatVisibility>;

type Seen = { id: string; authorId: string };

export function unreadCount(chat: readonly Seen[], lastReadId: string | null, selfId: string): number {
  const from = lastReadId === null ? -1 : chat.findIndex((m) => m.id === lastReadId);
  return chat.slice(from + 1).filter((m) => m.authorId !== selfId).length;
}
