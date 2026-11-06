import { ArrowUp, Bell, Mic, MicOff, Navigation, type LucideIcon } from 'lucide-react';
import type { DepartedPlayer, MicState, PlayerId, PresenceStatus } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import { focusWorld, usePlayControls, useViewYaw } from '@officexr/world/top-down';
import { formatDistance } from './formatDistance';
import { IconButton } from './IconButton';
import type { PingSender } from '../ping/usePingSender';
import { DEG, type PresencePlayer } from './personRows';
import { PRESENCE_INDICATOR } from './presenceColours';
import { useNow } from './useNow';

export const PANEL_CLASS =
  'pointer-events-auto max-h-60 max-w-72 overflow-y-auto overscroll-contain rounded bg-black/70 p-2 text-xs text-white';

/** `mic` is absent where the list doesn't show it. */
export type PersonRow = { id: PlayerId; label: string } & (
  | { type: 'self'; status: PresenceStatus; mic?: MicState }
  | ({ type: 'peer'; mic?: MicState } & Omit<PresencePlayer, 'id' | 'name'>)
  | ({ type: 'departed' } & Omit<DepartedPlayer, 'name'>)
  | { type: 'guest' }
);

const MIC = {
  none: null,
  muted: { Icon: MicOff, label: 'Muted', className: 'text-red-400' },
  silent: { Icon: Mic, label: 'Mic on', className: 'opacity-50' },
  speaking: { Icon: Mic, label: 'Speaking', className: 'motion-safe:animate-pulse text-green-400' },
} satisfies Record<MicState, { Icon: LucideIcon; label: string; className: string } | null>;

export function PersonList({
  label,
  rows,
  pinger,
  clock,
  announceNoRoute,
}: {
  label: string;
  rows: PersonRow[];
  /** Without it, rows have no Ping button. */
  pinger?: PingSender;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
  /** Render the "No route" live region; mount it in one list only so it is announced once. */
  announceNoRoute?: boolean;
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
      {announceNoRoute && (
        // Always mounted: a live region that mounts with its text is often not announced.
        <p role="status" className="sr-only">
          {unreachableLabel ? `No route to ${unreachableLabel}` : ''}
        </p>
      )}
    </>
  );
}

function PersonRowItem({
  row,
  now,
  viewYawDeg,
  following,
  noRoute,
  onGo,
  onPing,
}: {
  row: PersonRow;
  now: number;
  viewYawDeg: number;
  /** Whether the auto-walk targets this user, so clicking Go again cancels it. */
  following: boolean;
  noRoute: boolean;
  onGo: () => void;
  onPing?: { disabled: boolean; send: () => void };
}) {
  const kind = row.type === 'guest' ? null : row.type === 'self' ? row.status : presenceIndicator(row, now);
  const indicator = kind && PRESENCE_INDICATOR[kind];
  const mic = (row.type === 'self' || row.type === 'peer') && row.mic ? MIC[row.mic] : null;
  const away = row.type === 'peer' && kind === 'away';
  return (
    <li className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${row.type === 'self' ? 'bg-hud-inset' : ''}`}>
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hud-edge text-[10px] font-bold text-hud-text uppercase">
        <span aria-hidden>{row.label.charAt(0)}</span>
        {indicator && (
          <span
            role="img"
            aria-label={indicator.label}
            title={indicator.label}
            className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-hud-panel ${indicator.dot}`}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs ${row.type === 'departed' ? 'text-hud-text-2' : 'text-hud-text'}`}>
          {row.label}
        </span>
        {row.type === 'peer' && (noRoute || row.distanceM !== null) && (
          <span className="flex items-center gap-0.5 text-[10px] text-hud-text-2 tabular-nums">
            {noRoute && <span className="text-hud-amber-text">No route</span>}
            {row.distanceM !== null && (
              <>
                {away && <span>Away ·</span>}
                <ArrowUp
                  aria-hidden
                  className="h-2.5 w-2.5"
                  style={{ transform: `rotate(${Math.round(row.bearingDeg + viewYawDeg)}deg)` }}
                />
                <span>{formatDistance(row.distanceM)}</span>
              </>
            )}
          </span>
        )}
      </span>
      {mic && <mic.Icon role="img" aria-label={mic.label} className={`h-3 w-3 shrink-0 ${mic.className}`} />}
      {row.type === 'peer' && onPing && (
        <IconButton
          icon={Bell}
          label={`Ping ${row.label}`}
          disabled={onPing.disabled}
          size="row"
          onClick={onPing.send}
        />
      )}
      {row.type === 'peer' && (
        <IconButton
          icon={Navigation}
          label={`Go to ${row.label}`}
          pressed={following}
          tone={following ? 'success' : 'neutral'}
          size="row"
          onClick={onGo}
        />
      )}
    </li>
  );
}
