import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, Navigation } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import type { PingInbox } from '../ping/pingInbox';
import { IconButton } from './IconButton';
import { useEscapeLayer } from './useEscapeLayer';
import { sameList } from './sameFields';
import { Panel, PanelTitle } from './ui/Panel';
import { useNow } from './useNow';

const MAX_BADGE = 9;

const relativeTime = (ageMs: number) => {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};

const selectPresentIds = (s: OfficeState) => Object.keys(s.players).map((id) => ({ id }));
const samePresent = (a: { id: string }[], b: { id: string }[]) => sameList(a, b);
const unreadLabel = (n: number) => (n === 0 ? 'Pings' : `Pings, ${n} unread`);

/** Bell with an unread badge that toggles a list of the pings received this session. */
export function PingInboxHud({ inbox, store }: { inbox: PingInbox; store: Store }) {
  const [open, setOpen] = useState(false);
  const { entries, unread } = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  const present = new Set(useStoreSelector(store, selectPresentIds, samePresent).map((p) => p.id));
  const now = useNow(30_000, inbox.wallClock);
  const { goTo } = usePlayControls();
  useEffect(() => {
    if (open) {
      inbox.markAllRead();
    }
  }, [open, inbox, unread]);
  useEscapeLayer(open, () => {
    setOpen(false);
    focusWorld();
  });
  const go = (id: PlayerId) => {
    goTo(id);
    focusWorld();
  };
  return (
    <div data-studio-panel className="pointer-events-none relative flex">
      <IconButton
        icon={Bell}
        label={unreadLabel(unread)}
        expanded={open}
        onClick={() => {
          setOpen(!open);
          focusWorld();
        }}
      />
      <span role="status" className="sr-only">
        {unread > 0 ? `${unread} unread pings` : ''}
      </span>
      {unread > 0 && !open && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1.5 -right-1.5 min-w-4 rounded-full border-2 border-hud-rose bg-hud-rose-text px-1 text-center text-[10px] leading-3 font-bold text-hud-rose"
        >
          {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
        </span>
      )}
      {open && (
        <Panel className="pointer-events-auto absolute top-full right-0 mt-2 max-h-60 w-60 overflow-y-auto overscroll-contain p-2 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <PanelTitle className="text-xs">Pings</PanelTitle>
            {entries.length > 0 && (
              <button
                type="button"
                className="text-hud-text-2 underline hover:text-hud-text"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => inbox.clear()}
              >
                Clear
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            <p className="text-hud-text-2">No pings yet</p>
          ) : (
            <ul aria-label="Received pings">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <time
                    dateTime={new Date(e.receivedAt).toISOString()}
                    title={new Date(e.receivedAt).toLocaleTimeString()}
                    className="shrink-0 text-hud-text-2"
                  >
                    {relativeTime(now - e.receivedAt)}
                  </time>
                  <IconButton
                    icon={Navigation}
                    label={present.has(e.fromId) ? `Go to ${e.name}` : `${e.name} has left`}
                    disabled={!present.has(e.fromId)}
                    size="sm"
                    onClick={() => go(e.fromId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
