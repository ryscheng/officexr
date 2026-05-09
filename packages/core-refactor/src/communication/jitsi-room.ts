import type { PlayerId } from '@officexr/sdk';

/**
 * Lex-min room derivation: given the local user's id and the set of nearby
 * peer ids, returns a deterministic shared room id all parties will agree on.
 *
 * - If no nearby peers: returns null (caller leaves any current room).
 * - If at least one nearby peer: returns the lex-min of {self, ...nearby}.
 *   Two clients who agree on the membership set always derive the same room.
 *
 * This is the same lex-min seed today's `useJitsi.handleProximityChange`
 * uses.
 */
export function deriveJitsiRoom(
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
  return `room-${ids[0]}`;
}
