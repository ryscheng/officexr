import { useSyncExternalStore } from 'react';
import { RoomMenuItem } from './RoomMenu';

/** The part of the world's `XRStore` this item uses. */
export interface VrSessionStore {
  subscribe: (onChange: () => void) => () => void;
  getState: () => { session?: { end: () => Promise<void> } };
  enterVR: () => Promise<unknown>;
}

export function VrMenuItem({
  supported,
  store,
  onError,
}: {
  supported: boolean;
  store: VrSessionStore;
  onError: (message: string) => void;
}) {
  const inVr = useSyncExternalStore(store.subscribe, () => store.getState().session != null);
  if (!supported) {
    return null;
  }
  return inVr ? (
    <RoomMenuItem onSelect={() => void store.getState().session?.end()}>Exit VR</RoomMenuItem>
  ) : (
    <RoomMenuItem onSelect={() => store.enterVR().catch(() => onError('Could not start VR.'))}>Enter VR</RoomMenuItem>
  );
}
