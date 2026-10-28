import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { wrapAngle } from './relativeGeometry.ts';

const NOTIFY_THRESHOLD_RAD = Math.PI / 180;

/** The camera's yaw (the `yawRef` convention), published out of the Canvas for DOM overlays. */
export interface ViewYaw {
  get(): number;
  /** Updates and notifies only when the yaw moved at least 1° from the last published value. */
  set(yaw: number): void;
  subscribe(cb: () => void): () => void;
}

export function createViewYaw(): ViewYaw {
  let yaw = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => yaw,
    set(next) {
      if (Math.abs(wrapAngle(next - yaw)) < NOTIFY_THRESHOLD_RAD) {
        return;
      }
      yaw = next;
      listeners.forEach((cb) => cb());
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

const ViewYawContext = createContext<ViewYaw | null>(null);

export function ViewYawProvider(props: { viewYaw: ViewYaw; children?: ReactNode }) {
  return <ViewYawContext.Provider value={props.viewYaw}>{props.children}</ViewYawContext.Provider>;
}

/** The camera's current yaw in radians; re-renders on changes of at least 1°. */
export function useViewYaw(): number {
  const viewYaw = useContext(ViewYawContext);
  if (!viewYaw) {
    throw new Error('useViewYaw must be used inside a ViewYawProvider (PlayView provides one)');
  }
  return useSyncExternalStore(viewYaw.subscribe, viewYaw.get);
}
