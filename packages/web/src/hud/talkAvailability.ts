import type { PlayerState } from '@officexr/sdk';
import { firstName } from './peopleStatus';

export function busyReason(player: Pick<PlayerState, 'name' | 'status' | 'focus' | 'jitsiRoom'> | undefined): string | null {
  if (!player) {
    return null;
  }
  const first = firstName(player.name);
  if (player.jitsiRoom) {
    return `${first} is in a call`;
  }
  if (player.focus) {
    return `${first} is focusing`;
  }
  return player.status === 'away' ? `${first} is away` : null;
}
