import type { PlayerId, Store } from '@officexr/sdk';
import { senderName } from '../ping/senderName';

/** The name of `targetId` when they are in focus mode, so a pinger can be told the ping arrives silently. */
export function focusedTargetName(store: Store, targetId: PlayerId): string | null {
  return store.getState().players[targetId]?.focus ? senderName(store, targetId) : null;
}
