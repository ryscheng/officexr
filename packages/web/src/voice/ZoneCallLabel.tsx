import { deriveZoneRoom } from '@officexr/core-refactor';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/react';

const selectZoneLabel = (s: OfficeState) => {
  const room = s.players[s.selfId]?.jitsiRoom;
  return s.voiceZones.find((z) => room === deriveZoneRoom(s.officeId, z.id))?.label ?? null;
};

export function ZoneCallLabel({ store }: { store: Store }) {
  const label = useStoreSelector(store, selectZoneLabel);
  if (!label) {
    return null;
  }
  const text = `In ${label} call`;
  return (
    <span title={text} className="max-w-40 truncate px-2 text-xs text-white">
      {text}
    </span>
  );
}
