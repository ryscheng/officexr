import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import {
  createLabeller,
  PANEL_CLASS,
  PersonList,
  toPresencePlayer,
  type DepartedEntry,
  type PersonRow,
  type PresencePlayer,
} from './PersonList';
import { sameList } from './sameFields';

type PresenceRow = PersonRow & { name: string };
type Presence = {
  players: PresencePlayer[];
  departed: DepartedEntry[];
  status: OfficeState['realtime']['status'];
};

const byPresence = (a: PresenceRow, b: PresenceRow) =>
  Number(b.type === 'self') - Number(a.type === 'self') ||
  Number(!a.name) - Number(!b.name) ||
  a.name.localeCompare(b.name);

/** `players` and `departed` must be in join order; windows sharing a login are numbered by it. */
export function presenceRows(players: PresencePlayer[], departed: DepartedEntry[], selfId: PlayerId): PresenceRow[] {
  const labelOf = createLabeller();
  const present = players.map((p): PresenceRow => {
    const label = labelOf(p.id, p.name) + (p.id === selfId ? ' (you)' : '');
    return p.id === selfId
      ? {
          type: 'self',
          id: p.id,
          name: p.name,
          label,
          status: p.status,
          mic: p.mic,
        }
      : { type: 'peer', ...p, label };
  });
  const presentIds = new Set(players.map((p) => p.id));
  const gone = departed
    .filter((d) => d.name && !presentIds.has(d.id))
    .map(
      (d): PresenceRow => ({
        type: 'departed',
        ...d,
        label: labelOf(d.id, d.name),
      }),
    );
  return [...present.sort(byPresence), ...gone.sort(byPresence)];
}

const STATUS = {
  live: { text: 'Connected', dot: 'bg-green-500' },
  connecting: { text: 'Connecting…', dot: 'bg-gray-400' },
  'snapshot-pending': { text: 'Connecting…', dot: 'bg-gray-400' },
  reconnecting: { text: 'Reconnecting…', dot: 'bg-amber-500' },
  replaced: { text: 'Disconnected', dot: 'bg-red-500' },
} satisfies Record<Presence['status'], { text: string; dot: string }>;

const selectPresence = (s: OfficeState): Presence => {
  const selfPos = s.players[s.selfId]?.pos;
  return {
    players: Object.entries(s.players).map(([id, p]) => toPresencePlayer(id, p, selfPos)),
    departed: Object.entries(s.departed).map(([id, d]) => ({ id, ...d })),
    status: s.realtime.status,
  };
};
const samePresence = (a: Presence, b: Presence) =>
  a.status === b.status && sameList(a.players, b.players) && sameList(a.departed, b.departed);

export function PresenceList({
  store,
  selfId,
  officeName,
  clock,
  pinger,
}: {
  store: Store;
  selfId: PlayerId;
  officeName: string;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
  /** Without it, rows have no Ping button. */
  pinger?: PingSender;
}) {
  const { players, departed, status } = useStoreSelector(store, selectPresence, samePresence);
  const { text, dot } = STATUS[status];
  return (
    <div data-studio-panel className={PANEL_CLASS}>
      <div className="mb-1 flex items-center justify-between gap-3 font-medium">
        <span className="truncate">
          {officeName} ({players.length})
        </span>
        <span role="status" className="flex shrink-0 items-center gap-1 font-normal">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {text}
        </span>
      </div>
      <PersonList
        label={`People in ${officeName}`}
        rows={presenceRows(players, departed, selfId)}
        showMic={false}
        pinger={pinger}
        clock={clock}
      />
    </div>
  );
}
