import { useEffect, useRef, useState } from 'react';
import type { Actions, OfficeState, Store } from '@officexr/sdk';
import { focusWorld } from '@officexr/world/react';
import { useChatVisibility } from './useChatVisibility';
import { useStoreSelector } from '@officexr/world/react';

const MAX_MESSAGES = 50;
const MAX_LENGTH = 500;
const INTERACTIVE = 'input,textarea,select,button,[contenteditable],a[href]';

type Names = Record<string, string>;

const selectChat = (s: OfficeState) => s.chat;
const selectNames = (s: OfficeState): Names =>
  Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, p.name ?? '']));
const sameNames = (a: Names, b: Names) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

const isComposing = (e: { nativeEvent: KeyboardEvent }) =>
  e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;

type ChatPanelProps = { store: Store; actions: Actions; selfId: string };

export function ChatPanel({ store, actions, selfId }: ChatPanelProps) {
  const chat = useStoreSelector(store, selectChat);
  const names = useStoreSelector(store, selectNames, sameNames);
  const { mode, compose, peek, hide } = useChatVisibility(chat.length);
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const interactive = e.target instanceof Element && e.target.closest(INTERACTIVE);
      const modified = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
      if (e.key !== 'Enter' || interactive || modified || e.repeat || e.defaultPrevented || e.isComposing) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      compose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [compose]);

  useEffect(() => {
    if (mode === 'compose') {
      inputRef.current?.focus();
    }
  }, [mode]);

  // Clicking away keeps the draft but lets the panel auto-hide.
  useEffect(() => {
    if (mode !== 'compose') {
      return;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        peek();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mode, peek]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chat.length, mode]);

  if (mode === 'hidden') {
    return null;
  }

  const handBack = (next: () => void) => {
    inputRef.current?.blur();
    next();
    focusWorld();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) {
      return;
    }
    if (e.key === 'Escape') {
      setDraft('');
      handBack(hide);
    } else if (e.key === 'Enter') {
      const text = draft.trim();
      if (!text) {
        // Enter is the shortcut's toggle: on an empty draft it closes the panel.
        handBack(hide);
        return;
      }
      actions.appendChat({ id: `${selfId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, authorId: selfId, text, t: Date.now() });
      setDraft('');
      handBack(peek);
    }
  };

  return (
    <div
      ref={containerRef}
      data-studio-panel="true"
      className="absolute bottom-16 left-1/2 z-20 w-[500px] max-w-[90vw] -translate-x-1/2 text-sm text-white"
    >
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto overscroll-contain rounded-t-lg bg-black/75 px-3 py-2">
        {chat.slice(-MAX_MESSAGES).map((m) => (
          <div key={m.id} className="mb-1 break-words">
            <span className="mr-1.5 text-xs text-gray-500">
              {new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-bold text-blue-400">{names[m.authorId] || m.authorId}: </span>
            {m.text}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={compose}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        className="w-full rounded-b-lg bg-black/75 p-2 outline-none"
      />
    </div>
  );
}
