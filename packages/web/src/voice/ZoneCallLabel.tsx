import { deriveZoneRoom } from '@officexr/core-refactor';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { TITLE_TEXT } from '../hud/ui/Panel';

/** Null with no call; the zone's label in a zone call, else the proximity call. */
const selectCallKind = (s: OfficeState) => {
  const room = s.players[s.selfId]?.jitsiRoom;
  return room ? (s.voiceZones.find((z) => room === deriveZoneRoom(s.officeId, z.id))?.label ?? 'Proximity call') : null;
};

export function ZoneCallLabel({ store }: { store: Store }) {
  const kind = useStoreSelector(store, selectCallKind);
  return (
    <span className="flex min-w-0 flex-col px-1">
      <span className={`${TITLE_TEXT} truncate text-sm`}>{kind ? 'In call' : 'Not in a call'}</span>
      <span className="truncate text-[10px] text-hud-text-2">{kind ?? 'Walk up to someone to talk'}</span>
    </span>
  );
}
