import { deriveZoneRoom } from '@officexr/core-refactor';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/react';

const selectZoneLabel = (s: OfficeState) => {
  const room = s.players[s.selfId]?.jitsiRoom;
  return s.voiceZones.find((z) => room === deriveZoneRoom(s.officeId, z.id))?.label ?? null;
};

export function ZoneCallLabel({ store }: { store: Store }) {
  const label = useStoreSelector(store, selectZoneLabel);
  return label && <span className="pointer-events-none rounded bg-black/55 px-3 py-1.5 text-xs text-white">In {label} call</span>;
}
