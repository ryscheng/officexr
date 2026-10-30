import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { PlayerId, Vec3 } from '@officexr/sdk';
import type { AutoWalkState } from '../nav/autoWalk.ts';

/** What `PlayView` offers its overlays for steering the self player. */
export interface PlayControlsSource {
  /** Walks to `targetId` and keeps following them; the current target again stops. */
  goTo(targetId: PlayerId): void;
  /** Walks to a feet position on the floor, replacing any current walk. */
  goToPoint(target: Vec3): void;
  cancel(): void;
  getState(): AutoWalkState;
  subscribe(cb: () => void): () => void;
}

export interface PlayControls {
  goTo(targetId: PlayerId): void;
  goToPoint(target: Vec3): void;
  cancel(): void;
  state: AutoWalkState;
}

const PlayControlsContext = createContext<PlayControlsSource | null>(null);

export function PlayControlsProvider(props: { controls: PlayControlsSource; children?: ReactNode }) {
  return <PlayControlsContext.Provider value={props.controls}>{props.children}</PlayControlsContext.Provider>;
}

/** Re-renders when the walk state changes, not every frame. */
export function usePlayControls(): PlayControls {
  const controls = useContext(PlayControlsContext);
  if (!controls) {
    throw new Error('usePlayControls must be used inside a PlayControlsProvider (PlayView provides one)');
  }
  const state = useSyncExternalStore(controls.subscribe, controls.getState);
  return useMemo(() => ({ goTo: controls.goTo, goToPoint: controls.goToPoint, cancel: controls.cancel, state }), [controls, state]);
}
