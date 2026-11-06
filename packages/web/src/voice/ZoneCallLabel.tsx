import { deriveZoneRoom } from '@officexr/core-refactor';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { TITLE_TEXT } from '../hud/ui/Panel';

/** Null with no call; the zone's label in a zone call, else the proximity call. */
const selectCallSubline = (s: OfficeState) => {
  const room = s.players[s.selfId]?.jitsiRoom;
  return room ? (s.voiceZones.find((z) => room === deriveZoneRoom(s.officeId, z.id))?.label ?? 'Proximity call') : null;
};

export function ZoneCallLabel({ store, joining }: { store: Store; joining: boolean }) {
  const subline = useStoreSelector(store, selectCallSubline);
  const text = subline ?? 'Walk up to someone to talk';
  return (
    <span className="flex max-w-40 min-w-0 flex-col px-1">
      <span className={`${TITLE_TEXT} truncate text-sm`}>
        {!subline ? 'Not in a call' : joining ? 'Joining call' : 'In call'}
      </span>
      <span title={text} className="truncate text-[10px] text-hud-text-2">
        {text}
      </span>
    </span>
  );
}
