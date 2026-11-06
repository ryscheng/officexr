import type { MicState, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { PersonList, type PersonRow } from './PersonList';
import { labelsInJoinOrder, toPresencePlayer, type PresencePlayer } from './personRows';
import { sameList } from './sameFields';
import { Panel, PanelTitle } from './ui/Panel';

type CallPlayer = PresencePlayer & { mic: MicState; jitsiParticipantId: string | null };
type RosterEntry = { id: string; displayName: string };
type Call = { state: 'none' | 'joining' | 'connected'; players: CallPlayer[]; roster: RosterEntry[] };

/** `players` must be in join order and include everyone, so labels match the presence list's. */
export function callRows(roster: RosterEntry[], players: CallPlayer[], selfId: PlayerId): PersonRow[] {
  const labels = labelsInJoinOrder(players);
  const self = players.find((p) => p.id === selfId);
  const remote = roster
    .map((entry): PersonRow => {
      const peer = players.find((p) => p.id !== selfId && p.jitsiParticipantId === entry.id);
      return peer
        ? { type: 'peer', ...peer, label: labels.get(peer.id)! }
        : { type: 'guest', id: entry.id, label: entry.displayName || 'Guest' };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return self ? [{ type: 'self', id: self.id, label: 'You', status: self.status, mic: self.mic }, ...remote] : remote;
}

const selectCall = (s: OfficeState): Call => {
  const me = s.players[s.selfId];
  const state = !me?.jitsiRoom ? 'none' : me.jitsiParticipantId ? 'connected' : 'joining';
  if (state !== 'connected') {
    return { state, players: [], roster: [] };
  }
  return {
    state,
    players: Object.entries(s.players).map(([id, p]) => ({
      ...toPresencePlayer(id, p, me.pos),
      mic: p.mic,
      jitsiParticipantId: p.jitsiParticipantId,
    })),
    roster: Object.entries(s.callRoster).map(([id, { displayName }]) => ({ id, displayName })),
  };
};
const sameCall = (a: Call, b: Call) =>
  a.state === b.state && sameList(a.players, b.players) && sameList(a.roster, b.roster);

/** The call's state and, once connected, its rows with You first; empty otherwise. */
export function useCallRows(store: Store, selfId: PlayerId) {
  const { state, players, roster } = useStoreSelector(store, selectCall, sameCall);
  return { state, rows: state === 'connected' ? callRows(roster, players, selfId) : [] };
}

export function CallList({
  store,
  selfId,
  clock,
  pinger,
  id,
}: {
  store: Store;
  selfId: PlayerId;
  clock?: () => number;
  pinger?: PingSender;
  id?: string;
}) {
  const { state, rows } = useCallRows(store, selfId);
  return (
    <Panel
      id={id}
      className="pointer-events-auto max-h-60 w-72 max-w-full overflow-y-auto overscroll-contain p-2 text-xs"
    >
      <div className="mb-1 flex items-center gap-2">
        <PanelTitle>In call</PanelTitle>
        <span
          role="img"
          aria-label={`${rows.length} in call`}
          className="rounded-full bg-hud-sage px-2 text-[10px] text-hud-sage-text tabular-nums"
        >
          {rows.length}
        </span>
      </div>
      {state === 'connected' ? (
        <PersonList label="People in your call" rows={rows} pinger={pinger} clock={clock} />
      ) : state === 'joining' ? (
        <p className="rounded-hud-control bg-hud-amber px-2 py-1.5 text-hud-amber-text">
          Joining call
          <span aria-hidden className="motion-safe:animate-pulse">
            …
          </span>
        </p>
      ) : (
        <p className="rounded-hud-control border border-dashed border-hud-edge bg-hud-inset px-2 py-1.5 text-hud-text-2">
          Not in a call
        </p>
      )}
    </Panel>
  );
}
