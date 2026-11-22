import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { focusWorld, useCoarsePointer, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { Button } from './ui/Button';
import { Panel, PanelTitle } from './ui/Panel';
import { PortraitSheet } from './ui/PortraitSheet';
import { useLocalMutes, type LocalMutes } from './localMutes';
import { BlockedPeople } from '../social/BlockedPeople';
import { PersonMore } from '../social/PersonMore';
import { ReportForm } from '../social/ReportForm';
import { useSocial } from '../social/SocialProvider';
import { PersonAvatar } from './PersonAvatar';
import { PersonCard } from './PersonCard';
import { personStatus, statusLine } from './peopleStatus';
import { isPresent, usePresenceRows, type PresenceRow } from './presenceRows';
import { busyReason } from './talkAvailability';
import { useEscapeLayer } from './useEscapeLayer';
import { useNow } from './useNow';

const selectOffline = (s: OfficeState) => s.realtime.status === 'reconnecting';
const selectInCall = (s: OfficeState) => s.players[s.selfId]?.jitsiRoom ?? null;

const BACK_OR_CLOSE = 'flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent';

function PeopleRow({ row, now, muted, offline, onOpen, onGo }: { row: PresenceRow; now: number; muted: boolean; offline: boolean; onOpen: () => void; onGo: () => void }) {
  const status = personStatus(row, now);
  const body = (
    <>
      <PersonAvatar id={row.id} label={row.label} status={status} dim={row.type === 'departed'} />
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
  inviter?: PingSender;
  waver?: PingSender;
  mutes: LocalMutes;
  portrait: boolean;
  onWave: () => void;
  onInvite: () => void;
  onClose: () => void;
  clock?: () => number;
};

export function PeopleSheet({ store, selfId, officeName, pinger, inviter, waver, mutes, portrait, onWave, onInvite, onClose, clock }: PeopleSheetProps) {
  const headingId = useId();
  const rows = usePresenceRows(store, selfId);
  const offline = useStoreSelector(store, selectOffline);
  const muted = useLocalMutes(mutes);
  const now = useNow(1000, clock);
  const coarse = useCoarsePointer();
  const { goTo } = usePlayControls();
  const [openId, setOpenId] = useState<PlayerId | null>(null);
  const [view, setView] = useState<'card' | 'more' | 'report'>('card');
  const [blocking, setBlocking] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [notice, setNotice] = useState<{ login: string; name: string } | null>(null);
  const { caps, block, unblock, messagePerson } = useSocial();
  useEscapeLayer(true, onClose);
  const openPerson = (id: PlayerId | null) => {
    setOpenId(id);
    setView('card');
    setBlocking('idle');
  };

  const count = rows.filter(isPresent).length;
  const open = rows.find((row) => row.id === openId && row.type === 'peer');
  const myRoom = useStoreSelector(store, selectInCall);
  const openRoom = useStoreSelector(store, (s: OfficeState) => (open ? (s.players[open.id]?.jitsiRoom ?? null) : null));
  const busy = useStoreSelector(store, (s: OfficeState) => (open ? busyReason(s.players[open.id]) : null));
  const isMuted = (row: PresenceRow) => muted.has(loginOf(row.id));
  const go = (row: PresenceRow) => {
    goTo(row.id);
    focusWorld();
    onClose();
  };

  const doBlock = async (row: PresenceRow) => {
    setBlocking('busy');
    const login = loginOf(row.id);
    if (await block(login, row.name || row.label)) {
      setNotice({ login, name: row.name || row.label });
      openPerson(null);
    } else {
      setBlocking('failed');
    }
  };

  const title = open ? (view === 'more' ? 'More' : view === 'report' ? 'Report' : 'Person') : `People here · ${count}`;
  const alone = count === 1;
  const card = open && (
    <PersonCard
      row={open}
      now={now}
      offline={offline}
      muted={isMuted(open)}
      pingCoolingDown={pinger?.isCoolingDown(open.id) ?? false}
      compact={coarse && !portrait}
      onGo={() => go(open)}
      busyReason={busy}
      waveCoolingDown={waver?.isCoolingDown(open.id) ?? false}
      canInvite={myRoom !== null && openRoom !== myRoom}
      inviteCoolingDown={inviter?.isCoolingDown(open.id) ?? false}
      onWave={() => {
        onWave();
        waver?.ping(open.id);
      }}
      onInviteToTalk={() => {
        inviter?.ping(open.id);
        focusWorld();
      }}
      onToggleMute={() => mutes.toggle(loginOf(open.id))}
      onPing={() => {
        pinger?.ping(open.id);
        focusWorld();
      }}
      onMessage={
        caps.directChat
          ? () => {
              messagePerson(open.id);
              onClose();
            }
          : undefined
      }
      onMore={caps.block || caps.report ? () => setView('more') : undefined}
    />
  );
  const content: ReactNode = open ? (
    view === 'more' ? (
      <PersonMore
        name={open.label}
        canBlock={caps.block}
        canReport={caps.report}
        busy={blocking === 'busy'}
        failed={blocking === 'failed'}
        onBlock={() => void doBlock(open)}
        onReport={() => setView('report')}
      />
    ) : view === 'report' ? (
      <ReportForm login={loginOf(open.id)} name={open.label} onDone={() => setView('more')} />
    ) : (
      card
    )
  ) : (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-1">
      {notice && (
        <p role="status" className="flex min-h-12 items-center gap-2 rounded-hud-control bg-hud-inset px-3 text-base text-hud-text">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Blocked {notice.name}.</span>
          <Button
            className="min-h-12"
            onClick={async () => {
              if (await unblock(notice.login)) {
                setNotice(null);
              }
            }}
          >
            Undo
          </Button>
        </p>
      )}
      <ul aria-label={`People in ${officeName}`} className="divide-y divide-hud-separator">
        {rows.map((row) => (
          <PeopleRow key={row.id} row={row} now={now} muted={isMuted(row)} offline={offline} onOpen={() => openPerson(row.id)} onGo={() => go(row)} />
        ))}
      </ul>
      <BlockedPeople />
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
    <button
      type="button"
      aria-label={view === 'card' ? 'Back to people' : 'Back'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (view === 'card' ? openPerson(null) : setView(view === 'report' ? 'more' : 'card'))}
      className={BACK_OR_CLOSE}
    >
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
      <div className="flex max-h-[min(26rem,calc(100dvh-var(--hud-inset-top)-var(--hud-inset-bottom)-10rem))] min-h-0 flex-col">{content}</div>
    </Panel>
  );
}
