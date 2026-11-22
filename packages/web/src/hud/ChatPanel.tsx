import { useEffect, useMemo, useRef, useState } from 'react';
import { loginOf, type Actions, type OfficeState, type Store } from '@officexr/sdk';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { focusWorld, useCoarsePointer, useStoreSelector } from '@officexr/world/top-down';
import { IconButton } from './IconButton';
import { createChatHistory } from './chatHistory';
import { isComposing } from './isComposing';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';
import { Keycap } from './ui/Keycap';
import { FoldablePanel } from './ui/FoldablePanel';
import { PortraitSheet } from './ui/PortraitSheet';
import { CHIP, TITLE_TEXT } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';
import { useChatVisibility, type ChatVisibility } from './useChatVisibility';
import { EVERYONE, placeholderFor, scopeOfTarget, scopeTag, type ChatTarget } from '../social/chatScope';
import { ScopeLine } from '../social/ScopeLine';
import { useSocial } from '../social/SocialProvider';

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
  portrait?: boolean;
  unread?: number;
  hiddenLogins?: ReadonlySet<string>;
  onMissionCommand?: (title: string) => Promise<boolean>;
};

const MISSION_COMMAND = /^\/mission\s+(\S.*)$/i;

export function ChatPanel({ store, actions, selfId, visibility, portrait = false, unread = 0, hiddenLogins, onMissionCommand }: ChatPanelProps) {
  const allChat = useStoreSelector(store, selectChat);
  const chat = useMemo(() => (hiddenLogins?.size ? allChat.filter((m) => !hiddenLogins.has(loginOf(m.authorId))) : allChat), [allChat, hiddenLogins]);
  const names = useStoreSelector(store, selectNames, sameNames);
  const coarse = useCoarsePointer();
  const own = useChatVisibility(chat.length);
  const { mode, compose, peek, hide, collapse } = visibility ?? own;
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const history = useRef(createChatHistory()).current;
  const { caps, officeName, directRequest } = useSocial();
  const scoped = caps.nearbyChat || caps.directChat;
  const [target, setTarget] = useState<ChatTarget>(EVERYONE);
  const nameOf = (id: string) => names[id] || 'someone';
  const people = useMemo(() => Object.entries(names).filter(([id, name]) => id !== selfId && name).map(([id, name]) => ({ id, name })), [names, selfId]);
  const effective = target.type === 'direct' && !names[target.id] ? EVERYONE : target.type === 'nearby' && !caps.nearbyChat ? EVERYONE : target;

  const handledRequests = useRef(directRequest?.count ?? 0);
  useEffect(() => {
    if (directRequest && directRequest.count > handledRequests.current && caps.directChat) {
      handledRequests.current = directRequest.count;
      setTarget({ type: 'direct', id: directRequest.id });
      compose();
    }
  }, [directRequest, caps.directChat, compose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const interactive = e.target instanceof Element && e.target.closest(INTERACTIVE);
      const modified = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isHotkeyBlocked(e);
      if ((e.key !== 'Enter' && !slash) || interactive || modified || e.repeat || e.defaultPrevented || e.isComposing) {
        return;
      }
      e.preventDefault();
      if (slash) {
        setDraft((d) => `${d}/`);
      }
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
        inputRef.current?.blur();
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
    () => handBack(portrait ? hide : peek),
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
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const recalled = e.key === 'ArrowUp' ? history.older(draft) : history.newer();
      if (recalled !== null) {
        e.preventDefault();
        setDraft(recalled);
      }
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
    history.push(text);
    actions.appendChat({
      id: `${selfId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      authorId: selfId,
      text,
      t: Date.now(),
      ...scopeOfTarget(effective),
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
      history.push(`/mission ${raw}`);
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
        className={`overflow-y-auto overscroll-contain px-1 ${portrait ? 'min-h-0 flex-1 text-base' : 'max-h-48'}`}
      >
        {chat.slice(-MAX_MESSAGES).map((m) => (
          <div key={m.id} className="mb-1 break-words">
            <span className="mr-1.5 text-xs text-hud-text-2">
              {new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-bold text-hud-accent">{names[m.authorId] || m.authorId}: </span>
            {scopeTag(m, selfId, nameOf) && <span className="mr-1 text-xs text-hud-text-2">({scopeTag(m, selfId, nameOf)})</span>}
            {m.text}
          </div>
        ))}
      </div>
    );
  const scopeLine = scoped && <ScopeLine target={effective} people={people} onChange={setTarget} />;
  const composer = (
    <div className="flex shrink-0 items-center gap-2">
      <input
        ref={inputRef}
        value={draft}
        maxLength={MAX_LENGTH}
        onChange={(e) => {
          history.stopBrowsing();
          setDraft(e.target.value);
        }}
        onFocus={compose}
        onKeyDown={onKeyDown}
        placeholder={scoped ? placeholderFor(effective, officeName, nameOf) : coarse ? 'Message' : 'Press Enter to chat'}
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
        {scopeLine}
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
      {scopeLine}
      {composer}
    </FoldablePanel>
  );
}
