import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/react';

type PresencePlayer = { id: PlayerId; name: string };
type PresenceRow = { id: PlayerId; label: string; isSelf: boolean };
type Presence = { players: PresencePlayer[]; status: OfficeState['realtime']['status'] };

/** `players` must be in join order; windows sharing a login are numbered by it. */
export function presenceRows(players: PresencePlayer[], selfId: PlayerId): PresenceRow[] {
  const seen = new Map<string, number>();
  const rows = players.map(({ id, name }) => {
    const n = (seen.get(loginOf(id)) ?? 0) + 1;
    seen.set(loginOf(id), n);
    return {
      id,
      name: name || 'Joining…',
      label: `${name || 'Joining…'}${n > 1 ? ` (${n})` : ''}`,
      isSelf: id === selfId,
    };
  });
  return rows
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name))
    .map(({ id, label, isSelf }) => ({ id, label, isSelf }));
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
      className="pointer-events-auto absolute bottom-3 left-3 max-h-60 overflow-y-auto rounded bg-black/70 p-2 text-xs text-white"
    >
      <div className="mb-1 flex items-center justify-between gap-3 font-medium">
        <span>
          {officeName} ({players.length})
        </span>
        <span className="flex items-center gap-1 font-normal">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
          {text}
        </span>
      </div>
      <ul>
        {presenceRows(players, selfId).map((row) => (
          <li key={row.id}>
            {row.label}
            {row.isSelf && ' (you)'}
          </li>
        ))}
      </ul>
    </div>
  );
}
