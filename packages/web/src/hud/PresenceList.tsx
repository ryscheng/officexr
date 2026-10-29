import { ArrowUp, Mic, MicOff, type LucideIcon } from 'lucide-react';
import type { MicState, OfficeState, PlayerId, PlayerState, PresenceStatus, Store } from '@officexr/sdk';
import { loginOf, presenceIndicator } from '@officexr/sdk';
import { planarDistance, relativeBearing, useStoreSelector, useViewYaw } from '@officexr/world/react';
import { PRESENCE_INDICATOR } from './presenceColours';
import { useNow } from './useNow';

type PresencePlayer = Pick<PlayerState, 'id' | 'name' | 'status' | 'mic' | 'lastStatusAt' | 'firstSeenAt'> & {
  distanceM: number;
  /** Bearing for a view yaw of 0, in degrees rounded to 5°. */
  bearingDeg: number;
};
type DepartedEntry = { id: PlayerId; name: string; leftAt: number };
type PresenceRow = { id: PlayerId; name: string; label: string } & (
  | { type: 'self'; status: PresenceStatus; mic: MicState }
  | ({ type: 'peer' } & Omit<PresencePlayer, 'id' | 'name'>)
  | ({ type: 'departed' } & Omit<DepartedEntry, 'id' | 'name'>)
);
type Presence = { players: PresencePlayer[]; departed: DepartedEntry[]; status: OfficeState['realtime']['status'] };

const byPresence = (a: PresenceRow, b: PresenceRow) =>
  Number(b.type === 'self') - Number(a.type === 'self') ||
  Number(!a.name) - Number(!b.name) ||
  a.name.localeCompare(b.name);

/** `players` and `departed` must be in join order; windows sharing a login are numbered by it. */
export function presenceRows(players: PresencePlayer[], departed: DepartedEntry[], selfId: PlayerId): PresenceRow[] {
  const seen = new Map<string, number>();
  const labelOf = (id: PlayerId, name: string) => {
    const login = loginOf(id);
    const n = (seen.get(login) ?? 0) + 1;
    seen.set(login, n);
    return name ? `${name}${n > 1 ? ` (${n})` : ''}` : 'Joining…';
  };
  const present = players.map((p): PresenceRow => {
    const label = labelOf(p.id, p.name);
    return p.id === selfId
      ? { type: 'self', id: p.id, name: p.name, label, status: p.status, mic: p.mic }
      : { type: 'peer', ...p, label };
  });
  const presentIds = new Set(players.map((p) => p.id));
  const gone = departed
    .filter((d) => !presentIds.has(d.id))
    .map((d): PresenceRow => ({ type: 'departed', ...d, label: labelOf(d.id, d.name) }));
  return [...present.sort(byPresence), ...gone.sort(byPresence)];
}

const STATUS = {
  live: { text: 'Connected', dot: 'bg-green-500' },
  connecting: { text: 'Connecting…', dot: 'bg-gray-400' },
  'snapshot-pending': { text: 'Connecting…', dot: 'bg-gray-400' },
  reconnecting: { text: 'Reconnecting…', dot: 'bg-amber-500' },
  replaced: { text: 'Disconnected', dot: 'bg-red-500' },
} satisfies Record<Presence['status'], { text: string; dot: string }>;

const MIC = {
  none: null,
  muted: { Icon: MicOff, label: 'Muted', className: 'text-red-400' },
  silent: { Icon: Mic, label: 'Mic on', className: 'opacity-50' },
  speaking: { Icon: Mic, label: 'Speaking', className: 'animate-pulse text-green-400' },
} satisfies Record<MicState, { Icon: LucideIcon; label: string; className: string } | null>;

const DEG = 180 / Math.PI;

const selectPresence = (s: OfficeState): Presence => {
  const selfPos = s.players[s.selfId]?.pos;
  return {
    players: Object.entries(s.players).map(([id, p]) => ({
      id,
      name: p.name,
      status: p.status,
      mic: p.mic,
      lastStatusAt: p.lastStatusAt,
      firstSeenAt: p.firstSeenAt,
      distanceM: selfPos ? Math.floor(planarDistance(selfPos, p.pos)) : 0,
      bearingDeg: selfPos ? Math.round((relativeBearing(selfPos, 0, p.pos) * DEG) / 5) * 5 : 0,
    })),
    departed: Object.entries(s.departed).map(([id, d]) => ({ id, ...d })),
    status: s.realtime.status,
  };
};
const sameFields = <T extends object>(a: T, b: T) =>
  (Object.keys(a) as (keyof T)[]).every((k) => Object.is(a[k], b[k]));
const sameList = <T extends object>(a: T[], b: T[]) =>
  a.length === b.length && a.every((x, i) => sameFields(x, b[i]));
const samePresence = (a: Presence, b: Presence) =>
  a.status === b.status && sameList(a.players, b.players) && sameList(a.departed, b.departed);

export function PresenceList({
  store,
  selfId,
  officeName,
  clock,
}: {
  store: Store;
  selfId: PlayerId;
  officeName: string;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
}) {
  const { players, departed, status } = useStoreSelector(store, selectPresence, samePresence);
  const viewYawDeg = useViewYaw() * DEG;
  const now = useNow(1000, clock);
  const { text, dot } = STATUS[status];
  return (
    <div
      data-studio-panel
      className="pointer-events-auto max-h-60 max-w-72 overflow-y-auto overscroll-contain rounded bg-black/70 p-2 text-xs text-white"
    >
      <div className="mb-1 flex items-center justify-between gap-3 font-medium">
        <span className="truncate">
          {officeName} ({players.length})
        </span>
        <span role="status" className="flex shrink-0 items-center gap-1 font-normal">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {text}
        </span>
      </div>
      <ul aria-label={`People in ${officeName}`}>
        {presenceRows(players, departed, selfId).map((row) => {
          const indicator = PRESENCE_INDICATOR[row.type === 'self' ? row.status : presenceIndicator(row, now)];
          const mic = row.type === 'departed' ? null : MIC[row.mic];
          return (
            <li key={row.id} className="flex items-center gap-1.5">
              <span
                role="img"
                aria-label={indicator.label}
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicator.dot}`}
              />
              {mic && <mic.Icon role="img" aria-label={mic.label} className={`h-3 w-3 shrink-0 ${mic.className}`} />}
              <span className={`min-w-0 flex-1 truncate ${row.type === 'departed' ? 'text-white/60' : ''}`}>
                {row.label}
                {row.type === 'self' && ' (you)'}
              </span>
              {row.type === 'peer' && (
                <span className="flex shrink-0 items-center gap-0.5 tabular-nums text-white/80">
                  <ArrowUp
                    aria-hidden
                    className="h-3 w-3"
                    style={{ transform: `rotate(${Math.round(row.bearingDeg + viewYawDeg)}deg)` }}
                  />
                  {row.distanceM < 1 ? '<1 m' : `${row.distanceM} m`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
