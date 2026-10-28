import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/react';

type PresencePlayer = { id: PlayerId; name: string };
type PresenceRow = { id: PlayerId; name: string; label: string; isSelf: boolean };
type Presence = { players: PresencePlayer[]; status: OfficeState['realtime']['status'] };

/** `players` must be in join order; windows sharing a login are numbered by it. */
export function presenceRows(players: PresencePlayer[], selfId: PlayerId): PresenceRow[] {
  const seen = new Map<string, number>();
  return players
    .map(({ id, name }) => {
      const login = loginOf(id);
      const n = (seen.get(login) ?? 0) + 1;
      seen.set(login, n);
      return { id, name, label: name ? `${name}${n > 1 ? ` (${n})` : ''}` : 'Joining…', isSelf: id === selfId };
    })
    .sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) ||
        Number(!a.name) - Number(!b.name) ||
        a.name.localeCompare(b.name),
    );
}

const STATUS = {
  live: { text: 'Connected', dot: 'bg-green-500' },
  connecting: { text: 'Connecting…', dot: 'bg-gray-400' },
  'snapshot-pending': { text: 'Connecting…', dot: 'bg-gray-400' },
  reconnecting: { text: 'Reconnecting…', dot: 'bg-amber-500' },
  replaced: { text: 'Disconnected', dot: 'bg-red-500' },
} satisfies Record<Presence['status'], { text: string; dot: string }>;

const selectPresence = (s: OfficeState): Presence => ({
  players: Object.entries(s.players).map(([id, p]) => ({ id, name: p.name })),
  status: s.realtime.status,
});
const samePresence = (a: Presence, b: Presence) =>
  a.status === b.status &&
  a.players.length === b.players.length &&
  a.players.every((p, i) => p.id === b.players[i].id && p.name === b.players[i].name);

export function PresenceList({ store, selfId, officeName }: { store: Store; selfId: PlayerId; officeName: string }) {
  const { players, status } = useStoreSelector(store, selectPresence, samePresence);
  const { text, dot } = STATUS[status];
  return (
    <div
      data-studio-panel
      className="pointer-events-auto absolute bottom-3 left-3 pointer-coarse:bottom-40 max-h-60 max-w-64 overflow-y-auto overscroll-contain rounded bg-black/70 p-2 text-xs text-white"
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
        {presenceRows(players, selfId).map((row) => (
          <li key={row.id} className="truncate">
            {row.label}
            {row.isSelf && ' (you)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
