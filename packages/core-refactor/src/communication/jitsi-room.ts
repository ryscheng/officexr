import type { PlayerId } from '@officexr/sdk';

/** Every client must derive the same name from the office and zone id alone. */
export function deriveZoneRoom(officeId: string, zoneId: string): string {
  return `zone-${officeId}-${zoneId}`;
}

/**
 * Lex-min room derivation: given the office, the local user's id and the set
 * of nearby peer ids, returns a deterministic shared room id all parties will
 * agree on.
 *
 * - If no nearby peers: returns null (caller leaves any current room).
 * - If at least one nearby peer: returns the lex-min of {self, ...nearby},
 *   scoped to the office so the same players in two offices never share a
 *   room. Two clients who agree on the membership set always derive the same
 *   room.
 */
export function deriveJitsiRoom(
  officeId: string,
  selfId: PlayerId,
  nearby: Iterable<PlayerId>,
): string | null {
  const ids: string[] = [selfId];
  let any = false;
  for (const id of nearby) {
    if (id === selfId) continue;
    ids.push(id);
    any = true;
  }
  if (!any) return null;
  ids.sort();
  return `room-${officeId}-${ids[0]}`;
}
