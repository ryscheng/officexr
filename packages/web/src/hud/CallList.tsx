import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import {
  createLabeller,
  PANEL_CLASS,
  PersonList,
  toPresencePlayer,
  type PersonRow,
  type PresencePlayer,
} from './PersonList';
import { sameList } from './sameFields';

type CallPlayer = PresencePlayer & { jitsiParticipantId: string | null };
type RosterEntry = { id: string; displayName: string };
type Call = {
  /** `joining` until Jitsi hands us a participant id. */
  state: 'none' | 'joining' | 'connected';
  players: CallPlayer[];
  roster: RosterEntry[];
};

/** `players` must be in join order; matched windows sharing a login are numbered by it. */
export function callRows(roster: RosterEntry[], players: CallPlayer[], selfId: PlayerId): PersonRow[] {
  const labelOf = createLabeller();
  const peers = players.filter((p) => p.id !== selfId);
  const remote = roster.map((entry): PersonRow & { sortName: string } => {
    const peer = peers.find((p) => p.jitsiParticipantId === entry.id);
    if (!peer) {
      const label = entry.displayName || 'Guest';
      return { type: 'guest', id: entry.id, label, sortName: label };
    }
    return {
      type: 'peer',
      ...peer,
      label: labelOf(peer.id, peer.name),
      sortName: peer.name,
    };
  });
  const self = players.find((p) => p.id === selfId);
  return [
    ...(self
      ? [
          {
            type: 'self' as const,
            id: self.id,
            label: 'You',
            status: self.status,
            mic: self.mic,
          },
        ]
      : []),
    ...remote.sort((a, b) => a.sortName.localeCompare(b.sortName)),
  ];
}

const selectCall = (s: OfficeState): Call => {
  const me = s.players[s.selfId];
  const selfPos = me?.pos;
  return {
    state: !me?.jitsiRoom ? 'none' : me.jitsiParticipantId ? 'connected' : 'joining',
    players: Object.entries(s.players)
      .filter(([id, p]) => id === s.selfId || p.jitsiParticipantId)
      .map(([id, p]) => ({
        ...toPresencePlayer(id, p, selfPos),
        jitsiParticipantId: p.jitsiParticipantId,
      })),
    roster: Object.entries(s.callRoster).map(([id, { displayName }]) => ({
      id,
      displayName,
    })),
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
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
  /** Without it, rows have no Ping button. */
  pinger?: PingSender;
}) {
  const { state, players, roster } = useStoreSelector(store, selectCall, sameCall);
  const rows = state === 'connected' ? callRows(roster, players, selfId) : [];
  return (
    <div data-studio-panel className={PANEL_CLASS}>
      <div className="mb-1 font-medium">In call ({rows.length})</div>
      {state === 'connected' ? (
        <PersonList label="People in your call" rows={rows} showMic pinger={pinger} clock={clock} />
      ) : (
        <p className="text-white/70">{IDLE_TEXT[state]}</p>
      )}
    </div>
  );
}
