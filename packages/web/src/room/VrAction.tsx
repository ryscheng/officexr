import { useSyncExternalStore } from 'react';
import type { SettingsAction } from './Settings';
import { SettingsActionButton } from './SettingsModal';

/** The part of the world's `XRStore` this action uses. */
export interface VrSessionStore {
  subscribe: (onChange: () => void) => () => void;
  getState: () => { session?: { end: () => Promise<void> } };
  enterVR: () => Promise<unknown>;
}

export const vrActions = (
  store: VrSessionStore | undefined,
  supported: boolean,
  onError: (message: string) => void,
): SettingsAction[] =>
  store && supported
    ? [{ id: 'vr', render: (close) => <VrAction store={store} onError={onError} close={close} /> }]
    : [];

/** Closing Settings hands the keyboard back to the world, which a headset has no canvas to click to reclaim. */
function VrAction({
  store,
  onError,
  close,
}: {
  store: VrSessionStore;
  onError: (message: string) => void;
  close: () => void;
}) {
  const inVr = useSyncExternalStore(store.subscribe, () => store.getState().session != null);
  const enter = () =>
    store.enterVR().catch((error: unknown) => {
      console.error(error);
      onError('Could not start VR.');
    });
  // end() rejects once the session is already over, e.g. ended from the headset.
  const exit = () =>
    store
      .getState()
      .session?.end()
      .catch(() => {});
  return (
    <SettingsActionButton
      onClick={() => {
        close();
        void (inVr ? exit() : enter());
      }}
    >
      {inVr ? 'Exit VR' : 'Enter VR'}
    </SettingsActionButton>
  );
}
