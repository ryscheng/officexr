import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';

const selectLatest = (s: OfficeState) => {
  const last = s.chat.at(-1);
  return last ? { id: last.id, text: last.text, author: s.players[last.authorId]?.name || last.authorId } : null;
};
const sameLatest = (a: ReturnType<typeof selectLatest>, b: ReturnType<typeof selectLatest>) => a?.id === b?.id;

export const TICKER_MS = 5000;

/** One line with the newest message, above the thumb zone of a phone in portrait; the parent decides how long it shows. */
export function ChatTicker({ store }: { store: Store }) {
  const latest = useStoreSelector(store, selectLatest, sameLatest);
  if (!latest) {
    return null;
  }
  return (
    <div
      role="status"
      className="hud-glass pointer-events-none mx-auto max-w-full truncate rounded-full border border-hud-edge px-3 py-1.5 font-hud-body text-sm text-hud-text shadow-hud-control motion-safe:animate-hud-fade"
    >
      <span className="font-bold text-hud-accent">{latest.author}: </span>
      {latest.text}
    </div>
  );
}
