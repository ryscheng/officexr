import { useCallback } from 'react';
import { loginOf, type OfficeState, type Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';

type Latest = { id: string; text: string; author: string } | null;
const sameLatest = (a: Latest, b: Latest) => a?.id === b?.id;

export const TICKER_MS = 5000;

export function ChatTicker({ store, hiddenLogins, onOpen }: { store: Store; hiddenLogins?: ReadonlySet<string>; onOpen: () => void }) {
  const selectLatest = useCallback(
    (s: OfficeState): Latest => {
      const last = s.chat.at(-1);
      if (!last || hiddenLogins?.has(loginOf(last.authorId))) {
        return null;
      }
      return { id: last.id, text: last.text, author: s.players[last.authorId]?.name || last.authorId };
    },
    [hiddenLogins],
  );
  const latest = useStoreSelector(store, selectLatest, sameLatest);
  if (!latest) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={`New message from ${latest.author}, open chat`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      className="hud-glass pointer-events-auto line-clamp-2 min-h-12 max-w-[min(18rem,calc(100vw-2rem))] rounded-hud-panel border border-hud-edge px-3 py-2 text-left font-hud-body text-base text-hud-text shadow-hud-control motion-safe:animate-hud-fade"
    >
      <span className="font-bold text-hud-accent">{latest.author}: </span>
      {latest.text}
    </button>
  );
}
