import { useEffect, useMemo, useState } from 'react';
import { PanelLeftClose, Users } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useCoarsePointer, useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { IconButton } from './IconButton';
import { PersonList, type PersonRow } from './PersonList';
import { labelsInJoinOrder, toPresencePlayer, type DepartedEntry, type PresencePlayer } from './personRows';
import { useRosterCollapsed, type RosterStorage } from './rosterPrefs';
import { sameList } from './sameFields';
import { Panel, PanelTitle } from './ui/Panel';

type PresenceRow = Exclude<PersonRow, { type: 'guest' }> & { name: string };
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
      ? { type: 'self', id: p.id, name: p.name, label, status: p.status }
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
const samePresence = (a: Presence, b: Presence) =>
  sameList(a.players, b.players) && sameList(a.departed, b.departed);

const ARRIVAL_BUBBLE_MS = 4000;

const firstName = (name: string) => name.split(' ')[0];
const selectName = (id: PlayerId) => (s: OfficeState) => s.players[id]?.name ?? '';

/** Announces a player who joins while the roster is folded. */
function ArrivalBubble({ store, selfId }: { store: Store; selfId: PlayerId }) {
  const [arrival, setArrival] = useState<{ id: PlayerId } | null>(null);
  useEffect(
    () =>
      store.subscribe(
        (s) => s.players,
        (next, prev) => {
          const id = Object.keys(next).find((key) => key !== selfId && !(key in prev));
          if (id) {
            setArrival({ id });
          }
        },
      ),
    [store, selfId],
  );
  useEffect(() => {
    const timer = setTimeout(() => setArrival(null), ARRIVAL_BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [arrival]);
  return arrival && <ArrivalText store={store} id={arrival.id} />;
}

function ArrivalText({ store, id }: { store: Store; id: PlayerId }) {
  const name = useStoreSelector(store, useMemo(() => selectName(id), [id]));
  return (
    <span
      role="status"
      className="rounded-hud-control bg-hud-accent px-2 py-1 font-hud-body text-xs whitespace-nowrap text-hud-on-accent"
    >
      +1 {firstName(name)}
    </span>
  );
}

export function PresenceList({
  store,
  selfId,
  officeName,
  clock,
  pinger,
  storage,
}: {
  store: Store;
  selfId: PlayerId;
  officeName: string;
  clock?: () => number;
  pinger?: PingSender;
  /** Where the folded state is remembered; defaults to `localStorage`. */
  storage?: RosterStorage;
}) {
  const { players, departed } = useStoreSelector(store, selectPresence, samePresence);
  const [collapsed, setCollapsed] = useRosterCollapsed(useCoarsePointer(), storage);
  if (collapsed) {
    return (
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          aria-label={`Show people in ${officeName}`}
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          onMouseDown={(e) => e.preventDefault()}
          className="flex flex-col items-center gap-1.5 rounded-hud-control border-2 border-hud-edge bg-hud-panel px-1.5 py-2.5 font-hud-title text-hud-text shadow-hud-control hover:bg-hud-edge pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <Users aria-hidden className="h-4 w-4" />
          <span className="text-sm">{players.length}</span>
        </button>
        <ArrivalBubble store={store} selfId={selfId} />
      </div>
    );
  }
  return (
    <Panel className="pointer-events-auto flex max-h-60 w-56 flex-col">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Users aria-hidden className="h-4 w-4 shrink-0" />
        <PanelTitle className="flex-1 text-xs">In room</PanelTitle>
        <span className="rounded-full bg-hud-accent px-2 text-[10px] font-bold text-hud-on-accent">{players.length}</span>
        <IconButton icon={PanelLeftClose} label="Collapse people list" size="row" onClick={() => setCollapsed(true)} />
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1">
        <PersonList
          label={`People in ${officeName}`}
          rows={presenceRows(players, departed, selfId)}
          pinger={pinger}
          clock={clock}
          announceNoRoute
        />
      </div>
    </Panel>
  );
}
