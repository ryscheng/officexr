import { useSyncExternalStore } from 'react';

/** Used until a model's bounds are measured; close to the mean of the bundled characters. */
export const FALLBACK_CHARACTER_HEIGHT_M = 2.3;

/** World-space gap between the top of the head and the bottom of the overhead stack. */
export const OVERHEAD_GAP_M = 0.05;

const heights = new Map<string, number>();
const listeners = new Set<() => void>();

export function recordCharacterHeight(url: string, heightM: number): void {
  if (!Number.isFinite(heightM) || heightM <= 0 || heights.get(url) === heightM) return;
  heights.set(url, heightM);
  for (const l of listeners) l();
}

export const characterHeightOf = (url: string): number => heights.get(url) ?? FALLBACK_CHARACTER_HEIGHT_M;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useCharacterHeight = (url: string): number =>
  useSyncExternalStore(subscribe, () => characterHeightOf(url));

export const overheadAnchorY = (heightM: number): number => heightM + OVERHEAD_GAP_M;
