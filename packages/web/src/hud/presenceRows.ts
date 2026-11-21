import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PersonRow } from './PersonList';
import { labelsInJoinOrder, toPresencePlayer, type DepartedEntry, type PresencePlayer } from './personRows';
import { sameList } from './sameFields';

export type PresenceRow = Exclude<PersonRow, { type: 'guest' }> & { name: string };
type Presence = { players: PresencePlayer[]; departed: DepartedEntry[] };

const byPresence = (a: PresenceRow, b: PresenceRow) =>
  Number(b.type === 'self') - Number(a.type === 'self') ||
  Number(!a.name) - Number(!b.name) ||
  a.name.localeCompare(b.name);

/** `players` and `departed` must be in join order; windows sharing a login are numbered by it. */
export function presenceRows(players: PresencePlayer[], departed: DepartedEntry[], selfId: PlayerId): PresenceRow[] {
  const presentIds = new Set(players.map((p) => p.id));
  const goneEntries = departed.filter((d) => d.name && !presentIds.has(d.id));
  const labels = labelsInJoinOrder([...players, ...goneEntries]);
  const present = players.map((p): PresenceRow => {
    const label = `${labels.get(p.id)}${p.id === selfId ? ' (you)' : ''}`;
    return p.id === selfId
      ? { type: 'self', id: p.id, name: p.name, label, status: p.status, statusText: p.statusText }
      : { type: 'peer', ...p, label };
  });
  const gone = goneEntries.map((d): PresenceRow => ({ type: 'departed', ...d, label: labels.get(d.id)! }));
  return [...present.sort(byPresence), ...gone.sort(byPresence)];
}

const selectPresence = (s: OfficeState): Presence => {
  const selfPos = s.players[s.selfId]?.pos;
  return {
    players: Object.entries(s.players).map(([id, p]) => toPresencePlayer(id, p, selfPos)),
    departed: Object.entries(s.departed).map(([id, d]) => ({ id, ...d })),
  };
};
const samePresence = (a: Presence, b: Presence) => sameList(a.players, b.players) && sameList(a.departed, b.departed);

export const isPresent = (row: PresenceRow) => row.type !== 'departed';

export function usePresenceRows(store: Store, selfId: PlayerId): PresenceRow[] {
  const { players, departed } = useStoreSelector(store, selectPresence, samePresence);
  return presenceRows(players, departed, selfId);
}
