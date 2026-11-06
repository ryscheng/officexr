import type { MicState, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { PANEL_CLASS, PersonList, type PersonRow } from './PersonList';
import { labelsInJoinOrder, toPresencePlayer, type PresencePlayer } from './personRows';
import { sameList } from './sameFields';

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

const IDLE_TEXT = { none: 'Not in a call', joining: 'Joining call…' } as const;

export function CallList({
  store,
  selfId,
  clock,
  pinger,
}: {
  store: Store;
  selfId: PlayerId;
  clock?: () => number;
  pinger?: PingSender;
}) {
  const { state, players, roster } = useStoreSelector(store, selectCall, sameCall);
  const rows = state === 'connected' ? callRows(roster, players, selfId) : [];
  return (
    <div data-studio-panel className={PANEL_CLASS}>
      <div className="mb-1 font-medium">In call ({rows.length})</div>
      {state === 'connected' ? (
        <PersonList label="People in your call" rows={rows} pinger={pinger} clock={clock} />
      ) : (
        <p className="text-white/70">{IDLE_TEXT[state]}</p>
      )}
    </div>
  );
}
