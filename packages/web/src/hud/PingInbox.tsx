import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, Navigation } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import type { PingInbox } from '../ping/pingInbox';
import { IconButton } from './IconButton';
import { useNow } from './useNow';

const MAX_BADGE = 9;

const relativeTime = (ageMs: number) => {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};

const selectPresentIds = (s: OfficeState) => Object.keys(s.players).join('\n');

/** Bell with an unread badge that toggles a list of the pings received this session. */
export function PingInboxHud({ inbox, store }: { inbox: PingInbox; store: Store }) {
  const [open, setOpen] = useState(false);
  const { entries, unread } = useSyncExternalStore(inbox.subscribe, inbox.getSnapshot);
  const present = new Set(useStoreSelector(store, selectPresentIds).split('\n'));
  const now = useNow(30_000, inbox.wallClock);
  const { goTo } = usePlayControls();
  useEffect(() => {
    if (open) {
      inbox.markAllRead();
    }
  }, [open, inbox, unread]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        focusWorld();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const go = (id: PlayerId) => {
    goTo(id);
    focusWorld();
  };
  return (
    <div data-studio-panel className="pointer-events-none absolute top-[12px] right-[12px] flex flex-col items-end gap-2">
      <div className="relative">
        <IconButton
          icon={Bell}
          label="Pings"
          pressed={open}
          onClick={() => {
            setOpen(!open);
            focusWorld();
          }}
        />
        {unread > 0 && (
          <span
            role="status"
            aria-label={`${unread} unread pings`}
            className="pointer-events-none absolute -top-1 -right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white"
          >
            {unread > MAX_BADGE ? `${MAX_BADGE}+` : unread}
          </span>
        )}
      </div>
      {open && (
        <div className="pointer-events-auto max-h-60 w-60 overflow-y-auto overscroll-contain rounded bg-black/70 p-2 text-xs text-white">
          <div className="mb-1 flex items-center justify-between font-medium">
            Pings
            {entries.length > 0 && (
              <button type="button" className="font-normal underline" onMouseDown={(e) => e.preventDefault()} onClick={() => inbox.clear()}>
                Clear
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            <p className="text-white/60">No pings yet</p>
          ) : (
            <ul aria-label="Received pings">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <time
                    dateTime={new Date(e.receivedAt).toISOString()}
                    title={new Date(e.receivedAt).toLocaleTimeString()}
                    className="shrink-0 text-white/70"
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
        </div>
      )}
    </div>
  );
}
