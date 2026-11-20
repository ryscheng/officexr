import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';

const selectLatest = (s: OfficeState) => {
  const last = s.chat.at(-1);
  return last ? { id: last.id, text: last.text, author: s.players[last.authorId]?.name || last.authorId } : null;
};
const sameLatest = (a: ReturnType<typeof selectLatest>, b: ReturnType<typeof selectLatest>) => a?.id === b?.id;

export const TICKER_MS = 5000;

/** The newest message in up to two lines, above the bottom controls of a phone in portrait; a tap opens the chat. */
export function ChatTicker({ store, onOpen }: { store: Store; onOpen: () => void }) {
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
      className="hud-glass pointer-events-auto line-clamp-2 min-h-12 max-w-[min(18rem,calc(100vw-2rem))] rounded-hud-panel border border-hud-edge px-3 py-2 text-left font-hud-body text-sm text-hud-text shadow-hud-control motion-safe:animate-hud-fade"
    >
      <span className="font-bold text-hud-accent">{latest.author}: </span>
      {latest.text}
    </button>
  );
}
