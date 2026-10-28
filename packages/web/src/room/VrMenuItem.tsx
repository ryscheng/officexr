import { useSyncExternalStore } from 'react';
import { focusWorld } from '@officexr/world/react';
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
  const enter = () =>
    store.enterVR().then(
      // Tapping the menu released keyboard control from the world, and in a
      // headset there is no canvas to click to take it back.
      focusWorld,
      (error: unknown) => {
        console.error(error);
        onError('Could not start VR.');
      },
    );
  // end() rejects once the session is already over, e.g. ended from the headset.
  const exit = () => store.getState().session?.end().catch(() => {});
  return inVr ? (
    <RoomMenuItem onSelect={exit}>Exit VR</RoomMenuItem>
  ) : (
    <RoomMenuItem onSelect={enter}>Enter VR</RoomMenuItem>
  );
}
