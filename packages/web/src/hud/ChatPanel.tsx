import { useEffect, useRef, useState } from 'react';
import type { Actions, OfficeState, Store } from '@officexr/sdk';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { focusWorld, useStoreSelector } from '@officexr/world/top-down';
import { IconButton } from './IconButton';
import { isComposing } from './isComposing';
import { CHIP, Panel, PanelTitle, TITLE_TEXT } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';
import { useChatVisibility } from './useChatVisibility';

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

  const handBack = (next: () => void) => {
    inputRef.current?.blur();
    next();
    focusWorld();
  };

  useEscapeLayer(
    mode === 'compose',
    () => {
      setDraft('');
      handBack(hide);
    },
    () => containerRef.current,
  );

  if (mode === 'hidden') {
    return (
      <button
        type="button"
        data-studio-panel
        onClick={compose}
        className={`pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-2 ${CHIP} ${TITLE_TEXT}`}
      >
        <MessageSquare aria-hidden className="size-4" />
        <span className="pointer-coarse:sr-only">Chat · Enter</span>
      </button>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent)) {
      return;
    }
    if (e.key === 'Enter') {
      if (!draft.trim()) {
        // Enter is the shortcut's toggle: on an empty draft it closes the panel.
        handBack(hide);
        return;
      }
      send();
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    actions.appendChat({
      id: `${selfId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      authorId: selfId,
      text,
      t: Date.now(),
    });
    setDraft('');
    handBack(peek);
  };

  return (
    <Panel
      ref={containerRef}
      className="pointer-events-auto flex w-80 max-w-[calc(100vw-24px)] flex-col gap-1.5 p-2 text-sm"
    >
      <PanelTitle className="px-1 text-xs">Chat</PanelTitle>
      <div ref={listRef} className="max-h-48 overflow-y-auto overscroll-contain px-1">
        {chat.slice(-MAX_MESSAGES).map((m) => (
          <div key={m.id} className="mb-1 break-words">
            <span className="mr-1.5 text-xs text-hud-text-2">
              {new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-bold text-hud-accent">{names[m.authorId] || m.authorId}: </span>
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={compose}
          onKeyDown={onKeyDown}
          placeholder="Press Enter to chat"
          className="min-w-0 flex-1 rounded-hud-control bg-hud-inset px-3 py-1.5 text-hud-text outline-none placeholder:text-hud-text-2"
        />
        <IconButton icon={SendHorizontal} label="Send" tone="accent" disabled={!draft.trim()} onClick={send} />
      </div>
    </Panel>
  );
}
