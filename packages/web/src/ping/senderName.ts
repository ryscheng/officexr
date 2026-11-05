import { loginOf, type PlayerId, type Store } from '@officexr/sdk';

export const senderName = (store: Store, fromId: PlayerId): string =>
  store.getState().players[fromId]?.name || loginOf(fromId);
