import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { PlayerId } from '@officexr/sdk';
import type { AutoWalkState } from '../nav/autoWalk.ts';

export interface SeatingState {
  /** The seat the self player is touching, when they may sit on it and are not already on it. */
  nearbySeatId: string | null;
  /** The self player owns a desk that has a chair. */
  hasDesk: boolean;
}

/** What `PlayView` offers its overlays for steering the self player. */
export interface PlayControlsSource {
  /** Walks to `targetId` and keeps following them; the current target again stops. */
  goTo(targetId: PlayerId): void;
  cancel(): void;
  getState(): AutoWalkState;
  /** Notifies changes to both `getState` and `getSeating`. */
  subscribe(cb: () => void): () => void;
  /** Sits on `instanceId`, or on the touched seat; the player must touch it, and a refusal shows a toast. */
  sit(instanceId?: string): void;
  stand(): void;
  /** Walks to the self player's desk chair and sits on arrival; a no-op without one. */
  returnToDesk(): void;
  getSeating(): SeatingState;
}

export interface PlayControls extends SeatingState {
  goTo(targetId: PlayerId): void;
  cancel(): void;
  sit(instanceId?: string): void;
  stand(): void;
  returnToDesk(): void;
  state: AutoWalkState;
}

const PlayControlsContext = createContext<PlayControlsSource | null>(null);

export function PlayControlsProvider(props: { controls: PlayControlsSource; children?: ReactNode }) {
  return <PlayControlsContext.Provider value={props.controls}>{props.children}</PlayControlsContext.Provider>;
}

/** Re-renders when the walk or seating state changes, not every frame. */
export function usePlayControls(): PlayControls {
  const controls = useContext(PlayControlsContext);
  if (!controls) {
    throw new Error('usePlayControls must be used inside a PlayControlsProvider (PlayView provides one)');
  }
  const state = useSyncExternalStore(controls.subscribe, controls.getState);
  const { nearbySeatId, hasDesk } = useSyncExternalStore(controls.subscribe, controls.getSeating);
  return useMemo(
    () => ({
      goTo: controls.goTo,
      cancel: controls.cancel,
      sit: controls.sit,
      stand: controls.stand,
      returnToDesk: controls.returnToDesk,
      state,
      nearbySeatId,
      hasDesk,
    }),
    [controls, state, nearbySeatId, hasDesk],
  );
}
