import { ArrowUp, Bell, Mic, MicOff, Navigation, type LucideIcon } from 'lucide-react';
import type { DepartedPlayer, OfficeState, MicState, PlayerId, PlayerState, PresenceStatus } from '@officexr/sdk';
import { loginOf, presenceIndicator } from '@officexr/sdk';
import { focusWorld, planarDistance, relativeBearing, usePlayControls, useViewYaw } from '@officexr/world/top-down';
import { formatDistance } from './formatDistance';
import { IconButton } from './IconButton';
import type { PingSender } from '../ping/usePingSender';
import { PRESENCE_INDICATOR } from './presenceColours';
import { quantise } from './quantise';
import { useNow } from './useNow';

const DEG = 180 / Math.PI;

export const PANEL_CLASS =
  'pointer-events-auto max-h-60 max-w-72 overflow-y-auto overscroll-contain rounded bg-black/70 p-2 text-xs text-white';

export type PresencePlayer = Pick<PlayerState, 'id' | 'name' | 'status' | 'mic' | 'lastStatusAt' | 'firstSeenAt'> & {
  /** Null until your own position is known. */
  distanceM: number | null;
  /** Bearing for a view yaw of 0, in degrees rounded to 5°. */
  bearingDeg: number;
};
export type DepartedEntry = DepartedPlayer & { id: PlayerId };
export type PersonRow = { id: PlayerId; label: string } & (
  | { type: 'self'; status: PresenceStatus; mic: MicState }
  | ({ type: 'peer' } & Omit<PresencePlayer, 'id' | 'name'>)
  | ({ type: 'departed' } & Omit<DepartedEntry, 'id' | 'name'>)
  | { type: 'guest' }
);

export const toPresencePlayer = (
  id: PlayerId,
  p: OfficeState['players'][PlayerId],
  selfPos: PlayerState['pos'] | undefined,
): PresencePlayer => ({
  id,
  name: p.name,
  status: p.status,
  mic: p.mic,
  lastStatusAt: p.lastStatusAt,
  firstSeenAt: p.firstSeenAt,
  distanceM: selfPos ? Math.floor(planarDistance(selfPos, p.pos)) : null,
  bearingDeg: selfPos ? quantise(relativeBearing(selfPos, 0, p.pos) * DEG, 5) : 0,
});

/** Labels in join order, numbering windows that share a login. */
export function createLabeller() {
  const seen = new Map<string, number>();
  return (id: PlayerId, name: string) => {
    const login = loginOf(id);
    const n = (seen.get(login) ?? 0) + 1;
    seen.set(login, n);
    return name ? `${name}${n > 1 ? ` (${n})` : ''}` : 'Joining…';
  };
}

const MIC = {
  none: null,
  muted: { Icon: MicOff, label: 'Muted', className: 'text-red-400' },
  silent: { Icon: Mic, label: 'Mic on', className: 'opacity-50' },
  speaking: {
    Icon: Mic,
    label: 'Speaking',
    className: 'motion-safe:animate-pulse text-green-400',
  },
} satisfies Record<MicState, { Icon: LucideIcon; label: string; className: string } | null>;

export function PersonList({
  label,
  rows,
  showMic,
  pinger,
  clock,
}: {
  label: string;
  rows: PersonRow[];
  showMic: boolean;
  /** Without it, rows have no Ping button. */
  pinger?: PingSender;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
}) {
  const viewYawDeg = useViewYaw() * DEG;
  const now = useNow(1000, clock);
  const { goTo, state } = usePlayControls();
  // A no-route walk keeps re-planning, so its button stays pressed: clicking it again cancels.
  const following = state.type === 'idle' ? null : state.targetId;
  const unreachable = state.type === 'no-route' ? state.targetId : null;
  const unreachableLabel = rows.find((row) => row.id === unreachable)?.label;
  return (
    <>
      <ul aria-label={label}>
        {rows.map((row) => (
          <PersonRowItem
            key={row.id}
            row={row}
            showMic={showMic}
            now={now}
            viewYawDeg={viewYawDeg}
            following={row.id === following}
            noRoute={row.id === unreachable}
            onGo={() => {
              goTo(row.id);
              focusWorld();
            }}
            onPing={
              pinger && {
                disabled: pinger.isCoolingDown(row.id),
                send: () => {
                  pinger.ping(row.id);
                  focusWorld();
                },
              }
            }
          />
        ))}
      </ul>
      {/* Always mounted: a live region that mounts with its text is often not announced. */}
      <p role="status" className="sr-only">
        {unreachableLabel ? `No route to ${unreachableLabel}` : ''}
      </p>
    </>
  );
}

function PersonRowItem({
  row,
  showMic,
  now,
  viewYawDeg,
  following,
  noRoute,
  onGo,
  onPing,
}: {
  row: PersonRow;
  showMic: boolean;
  now: number;
  viewYawDeg: number;
  /** Whether the auto-walk targets this user, so clicking Go again cancels it. */
  following: boolean;
  noRoute: boolean;
  onGo: () => void;
  onPing?: { disabled: boolean; send: () => void };
}) {
  const indicator =
    row.type === 'guest' ? null : PRESENCE_INDICATOR[row.type === 'self' ? row.status : presenceIndicator(row, now)];
  const mic = showMic && (row.type === 'self' || row.type === 'peer') ? MIC[row.mic] : null;
  return (
    <li className="flex items-center gap-1.5">
      {indicator && (
        <span
          role="img"
          aria-label={indicator.label}
          title={indicator.label}
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicator.dot}`}
        />
      )}
      {mic && <mic.Icon role="img" aria-label={mic.label} className={`h-3 w-3 shrink-0 ${mic.className}`} />}
      <span className={`min-w-0 flex-1 truncate ${row.type === 'departed' ? 'text-white/60' : ''}`}>{row.label}</span>
      {row.type === 'peer' && noRoute && <span className="shrink-0 text-amber-400">No route</span>}
      {row.type === 'peer' && row.distanceM !== null && (
        <span className="flex shrink-0 items-center gap-0.5 tabular-nums text-white/80">
          <ArrowUp
            aria-hidden
            className="h-3 w-3"
            style={{
              transform: `rotate(${Math.round(row.bearingDeg + viewYawDeg)}deg)`,
            }}
          />
          {formatDistance(row.distanceM)}
        </span>
      )}
      {row.type === 'peer' && onPing && (
        <IconButton
          icon={Bell}
          label={`Ping ${row.label}`}
          disabled={onPing.disabled}
          size="sm"
          onClick={onPing.send}
        />
      )}
      {row.type === 'peer' && (
        <IconButton
          icon={Navigation}
          label={`Go to ${row.label}`}
          pressed={following}
          tone={following ? 'success' : 'neutral'}
          size="sm"
          onClick={onGo}
        />
      )}
    </li>
  );
}
