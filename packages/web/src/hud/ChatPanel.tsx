import { useEffect, useRef, useState } from 'react';
import type { Actions, OfficeState, Store } from '@officexr/sdk';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { focusWorld, useCoarsePointer, useStoreSelector } from '@officexr/world/top-down';
import { IconButton } from './IconButton';
import { isComposing } from './isComposing';
import { Keycap } from './ui/Keycap';
import { FoldablePanel } from './ui/FoldablePanel';
import { PortraitSheet } from './ui/PortraitSheet';
import { CHIP, TITLE_TEXT } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';
import { useChatVisibility, type ChatVisibility } from './useChatVisibility';

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

type ChatPanelProps = {
  store: Store;
  actions: Actions;
  selfId: string;
  /** Shared with a parent that has its own chat button; the panel keeps its own when absent. */
  visibility?: ChatVisibility;
  /** Phone portrait: the open chat is a bottom sheet and a peek shows nothing here (see `ChatTicker`). */
  portrait?: boolean;
  unread?: number;
  onMissionCommand?: (title: string) => Promise<boolean>;
};

const MISSION_COMMAND = /^\/mission\s+(\S.*)$/i;

export function ChatPanel({ store, actions, selfId, visibility, portrait = false, unread = 0, onMissionCommand }: ChatPanelProps) {
  const chat = useStoreSelector(store, selectChat);
  const names = useStoreSelector(store, selectNames, sameNames);
  const coarse = useCoarsePointer();
  const own = useChatVisibility(chat.length, { defaultFolded: coarse });
  const { mode, compose, peek, hide, collapse } = visibility ?? own;
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
      const target = e.target as Element;
      if (!containerRef.current?.contains(target) && !target.closest('[data-chat-toggle]')) {
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

  if (portrait ? mode !== 'compose' : mode === 'hidden') {
    if (portrait || coarse) {
      return null;
    }
    const last = chat.at(-1);
    return (
      <button
        type="button"
        data-studio-panel
        aria-label={unread ? `Chat, ${unread} new` : 'Chat'}
        onClick={compose}
        className={`pointer-events-auto flex w-86 max-w-[calc(100vw-24px)] items-center gap-2 px-3 py-2 text-left text-sm ${CHIP} rounded-hud-panel ${TITLE_TEXT}`}
      >
        <MessageSquare aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-normal">
          {unread && last ? `${names[last.authorId] || last.authorId}: ${last.text}` : 'Chat'}
        </span>
        {unread > 0 && (
          <span aria-hidden className="rounded-full bg-hud-accent px-1.5 text-[11px] font-bold text-hud-on-accent">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        <Keycap>Enter</Keycap>
      </button>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent)) {
      return;
    }
    if (e.key === 'Enter') {
      if (!draft.trim()) {
        // Enter is the shortcut's toggle: on an empty draft it closes the panel, but a phone keeps its keyboard.
        if (!portrait) {
          handBack(hide);
        }
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
    const command = onMissionCommand && MISSION_COMMAND.exec(text);
    if (command) {
      void sendMissionCommand(command[1].trim());
      return;
    }
    actions.appendChat({
      id: `${selfId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      authorId: selfId,
      text,
      t: Date.now(),
    });
    setDraft('');
    if (!portrait) {
      handBack(peek);
    }
  };

  const sendMissionCommand = async (raw: string) => {
    const title = Array.from(raw).slice(0, 140).join('');
    const added = await onMissionCommand!(title);
    actions.applyRemoteChat({
      id: `mission:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      authorId: 'Missions',
      text: added ? `Added mission "${title}"` : 'Could not add the mission',
      t: Date.now(),
    });
    if (added) {
      setDraft('');
      if (!portrait) {
        handBack(peek);
      }
    }
  };

  const log =
    chat.length === 0 ? (
      <p className="px-1 text-xs text-hud-text-2">No messages yet.</p>
    ) : (
      <div
        ref={listRef}
        className={`overflow-y-auto overscroll-contain px-1 ${portrait ? 'min-h-0 flex-1' : 'max-h-48'}`}
      >
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
    );
  const composer = (
    <div className="flex shrink-0 items-center gap-1.5">
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={compose}
        onKeyDown={onKeyDown}
        placeholder={coarse ? 'Message' : 'Press Enter to chat'}
        enterKeyHint="send"
        className="min-w-0 flex-1 rounded-hud-control bg-hud-inset px-3 py-1.5 text-hud-text outline-none placeholder:text-hud-text-2 pointer-coarse:min-h-12 pointer-coarse:text-base"
      />
      <IconButton icon={SendHorizontal} label="Send" tone="accent" disabled={!draft.trim()} onClick={send} />
    </div>
  );

  if (portrait) {
    return (
      <PortraitSheet ref={containerRef} title="Chat" label="Chat" closeLabel="Collapse chat" fill onClose={() => handBack(collapse)}>
        {log}
        {composer}
      </PortraitSheet>
    );
  }

  return (
    <FoldablePanel
      ref={containerRef}
      fold={{ folded: false, setFolded: () => undefined, toggle: () => handBack(collapse) }}
      title="Chat"
      label="chat"
      titleClassName="px-1 text-xs"
      className="pointer-events-auto flex w-86 max-w-[calc(100vw-24px)] flex-col gap-1.5 p-2 text-sm"
    >
      {log}
      {composer}
    </FoldablePanel>
  );
}
