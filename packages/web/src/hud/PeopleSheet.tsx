import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { Button } from './ui/Button';
import { Panel, PanelTitle } from './ui/Panel';
import { PortraitSheet } from './ui/PortraitSheet';
import { useLocalMutes, type LocalMutes } from './localMutes';
import { PersonAvatar } from './PersonAvatar';
import { PersonCard } from './PersonCard';
import { personStatus, statusLine } from './peopleStatus';
import { isPresent, usePresenceRows, type PresenceRow } from './presenceRows';
import { useEscapeLayer } from './useEscapeLayer';
import { useNow } from './useNow';

const selectOffline = (s: OfficeState) => s.realtime.status === 'reconnecting';

const BACK_OR_CLOSE = 'flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent';

function PeopleRow({ row, now, muted, offline, onOpen, onGo }: { row: PresenceRow; now: number; muted: boolean; offline: boolean; onOpen: () => void; onGo: () => void }) {
  const status = personStatus(row, now);
  const body = (
    <>
      <PersonAvatar label={row.label} status={status} dim={row.type === 'departed'} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-base leading-[22px] font-semibold ${row.type === 'departed' ? 'text-hud-text-2' : 'text-hud-text'}`}>{row.label}</span>
        <span className="block truncate text-sm leading-5 text-hud-text-2">{statusLine(row, now, muted)}</span>
      </span>
    </>
  );
  return (
    <li className="flex min-h-14 items-center gap-2 py-1">
      {row.type === 'peer' ? (
        <button
          type="button"
          aria-label={`${row.label}, ${statusLine(row, now, muted)}. Show options`}
          onClick={onOpen}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-2">{body}</div>
      )}
      {row.type !== 'self' && (
        <Button className="min-h-12 min-w-14" disabled={row.type !== 'peer' || offline} aria-label={`Go to ${row.label}`} onClick={onGo}>
          Go
        </Button>
      )}
    </li>
  );
}

type PeopleSheetProps = {
  store: Store;
  selfId: PlayerId;
  officeName: string;
  pinger?: PingSender;
  mutes: LocalMutes;
  portrait: boolean;
  onWave: () => void;
  onInvite: () => void;
  onClose: () => void;
  clock?: () => number;
};

export function PeopleSheet({ store, selfId, officeName, pinger, mutes, portrait, onWave, onInvite, onClose, clock }: PeopleSheetProps) {
  const headingId = useId();
  const rows = usePresenceRows(store, selfId);
  const offline = useStoreSelector(store, selectOffline);
  const muted = useLocalMutes(mutes);
  const now = useNow(1000, clock);
  const { goTo } = usePlayControls();
  const [openId, setOpenId] = useState<PlayerId | null>(null);
  useEscapeLayer(true, onClose);

  const count = rows.filter(isPresent).length;
  const open = rows.find((row) => row.id === openId && row.type === 'peer');
  const isMuted = (row: PresenceRow) => muted.has(loginOf(row.id));
  const go = (row: PresenceRow) => {
    goTo(row.id);
    focusWorld();
    onClose();
  };

  const title = open ? 'Person' : `People here · ${count}`;
  const alone = count === 1;
  const content: ReactNode = open ? (
    <PersonCard
      row={open}
      now={now}
      offline={offline}
      muted={isMuted(open)}
      pingCoolingDown={pinger?.isCoolingDown(open.id) ?? false}
      onGo={() => go(open)}
      onWave={onWave}
      onToggleMute={() => mutes.toggle(loginOf(open.id))}
      onPing={() => {
        pinger?.ping(open.id);
        focusWorld();
      }}
    />
  ) : (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-1">
      <ul aria-label={`People in ${officeName}`} className="divide-y divide-hud-separator">
        {rows.map((row) => (
          <PeopleRow key={row.id} row={row} now={now} muted={isMuted(row)} offline={offline} onOpen={() => setOpenId(row.id)} onGo={() => go(row)} />
        ))}
      </ul>
      {alone && (
        <div className="flex flex-col gap-2 pb-1">
          <p className="text-base text-hud-text-2">Only you are here.</p>
          <Button tone="primary" className="min-h-12 w-full" onClick={onInvite}>
            Invite people
          </Button>
        </div>
      )}
    </div>
  );
  const back = open && (
    <button type="button" aria-label="Back to people" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpenId(null)} className={BACK_OR_CLOSE}>
      <ArrowLeft aria-hidden className="size-5" />
    </button>
  );

  if (portrait) {
    return (
      <PortraitSheet title={title} label="People here" closeLabel="Close people" heightPct={open ? undefined : 60} headerExtra={back} onClose={onClose}>
        {content}
      </PortraitSheet>
    );
  }
  return (
    <Panel material="thick" role="dialog" aria-labelledby={headingId} className="pointer-events-auto flex w-[min(380px,50vw)] flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-2 pl-2">
        {back}
        <PanelTitle id={headingId} className="flex-1 text-base">
          {title}
        </PanelTitle>
        <button type="button" aria-label="Close people" onClick={onClose} className={BACK_OR_CLOSE}>
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="flex max-h-[min(60dvh,26rem)] min-h-0 flex-col">{content}</div>
    </Panel>
  );
}
