import { useSyncExternalStore } from 'react';

const KEY = 'officexr:showPerformance';
const listeners = new Set<() => void>();

function read(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

let current = read(globalThis.localStorage ?? { getItem: () => null });

export function storedShowPerformance(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return read(storage);
}

export function setShowPerformance(on: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  current = on;
  try {
    if (on) storage.setItem(KEY, 'on');
    else storage.removeItem(KEY);
  } catch {
    // The choice then lasts until the page reloads.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export const useShowPerformance = () => useSyncExternalStore(subscribe, () => current, () => false);
