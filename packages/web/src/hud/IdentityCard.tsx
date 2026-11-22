import { useSyncExternalStore } from 'react';
import { Menu, MessageSquare, Users } from 'lucide-react';
import type { OfficeState, Store } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { PortraitFace } from './PortraitFace';
import { useSelfPortrait } from './playerPortrait';
import { PRESENCE_INDICATOR } from './presenceColours';
import { RoundButton } from './RoundButton';
import { sameFields } from './sameFields';
import { Panel, TITLE_TEXT } from './ui/Panel';
import { performanceNow } from './useNow';

const RING = { available: 'ring-green-500', away: 'ring-yellow-400', unresponsive: 'ring-red-500', offline: 'ring-red-500' } as const;

type Self = { name: string; status: OfficeState['players'][string]['status']; lastStatusAt: number | undefined; firstSeenAt: number | undefined; statusText: string | null };

const selectSelf = (s: OfficeState): Self => {
  const p = s.players[s.selfId];
  return { name: p?.name ?? '', status: p?.status ?? 'available', lastStatusAt: p?.lastStatusAt, firstSeenAt: p?.firstSeenAt, statusText: p?.statusText ?? null };
};

const subscribeSecond = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};

export function IdentityCard({
  store,
  officeName,
  unread,
  chatOpen,
  menuOpen,
  headcount,
  peopleOpen,
  onPeople,
  onChat,
  onMenu,
}: {
  store: Store;
  officeName: string;
  unread: number;
  chatOpen: boolean;
  menuOpen: boolean;
  headcount: number;
  peopleOpen: boolean;
  onPeople: () => void;
  onChat: () => void;
  onMenu: () => void;
}) {
  const self = useStoreSelector(store, selectSelf, sameFields);
  const portrait = useSelfPortrait();
  const indicator = useSyncExternalStore(subscribeSecond, () => presenceIndicator(self, performanceNow()));
  const presence = PRESENCE_INDICATOR[indicator];
  return (
    <Panel className="pointer-events-auto flex w-86 max-w-[calc(100vw-24px)] items-center gap-3 p-2">
      <span aria-hidden className={`relative flex size-11 shrink-0 rounded-full bg-hud-avatar text-sm font-semibold text-hud-text ring-2 ${RING[indicator]}`}>
        <PortraitFace src={portrait} initial={self.name.trim().charAt(0).toUpperCase() || '?'} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`${TITLE_TEXT} truncate text-sm`}>{self.name || 'You'}</div>
        <div className="truncate text-xs text-hud-text-2">
          {self.statusText || presence.label} · {officeName}
        </div>
      </div>
      <RoundButton data-people-toggle aria-label={`People here, ${headcount}`} aria-expanded={peopleOpen} onClick={onPeople}>
        <Users aria-hidden className="size-5" />
        <span aria-hidden className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-hud-accent-fill px-1 text-xs font-bold text-hud-on-accent">
          {headcount}
        </span>
      </RoundButton>
      <RoundButton aria-label={unread ? `Chat, ${unread} new` : 'Chat'} aria-pressed={chatOpen} onClick={onChat}>
        <MessageSquare aria-hidden className="size-5" />
        {unread > 0 && (
          <span aria-hidden className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </RoundButton>
      <RoundButton aria-label="Office menu" aria-expanded={menuOpen} onClick={onMenu}>
        <Menu aria-hidden className="size-5" />
      </RoundButton>
    </Panel>
  );
}
