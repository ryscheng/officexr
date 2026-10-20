import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Actions, Store } from '@officexr/sdk';

const MAX_MESSAGES = 50;
const AUTO_HIDE_MS = 10_000;

type ChatPanelProps = { store: Store; actions: Actions; selfId: string };

export function ChatPanel({ store, actions, selfId }: ChatPanelProps) {
  const chat = useSyncExternalStore(
    (onChange) => store.subscribe((s) => s.chat, onChange),
    () => store.getState().chat,
  );
  const players = useSyncExternalStore(
    (onChange) => store.subscribe((s) => s.players, onChange),
    () => store.getState().players,
  );
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seen = useRef(chat.length);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Enter' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (chat.length !== seen.current) {
      seen.current = chat.length;
      setOpen(true);
    }
  }, [chat.length]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setFocused(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || focused || text) {
      return;
    }
    const timer = setTimeout(() => setOpen(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [open, focused, text, chat.length]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chat.length, open]);

  if (!open) {
    return null;
  }

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }
    actions.appendChat({ id: crypto.randomUUID(), authorId: selfId, text: trimmed, t: Date.now() });
    setText('');
  };

  return (
    <div
      data-studio-panel="true"
      className="absolute bottom-14 left-1/2 z-20 w-[500px] max-w-[90vw] -translate-x-1/2 text-sm text-white"
    >
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto rounded-t-lg bg-black/75 px-3 py-2">
        {chat.slice(-MAX_MESSAGES).map((m) => (
          <div key={m.id} className="mb-1">
            <span className="mr-1.5 text-xs text-gray-500">
              {new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="font-bold text-blue-400">{players[m.authorId]?.name || m.authorId}: </span>
            {m.text}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            send();
          } else if (e.key === 'Escape') {
            setText('');
            setOpen(false);
          }
        }}
        placeholder="Type a message..."
        className="w-full rounded-b-lg bg-black/75 p-2 outline-none"
      />
    </div>
  );
}
