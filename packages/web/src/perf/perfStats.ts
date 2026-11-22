import { useSyncExternalStore } from 'react';
import type { FrameStatsSample } from '@officexr/world/renderer';
import { createFrameWindow, type FrameSummary } from './frameWindow';

const window5s = createFrameWindow();
const listeners = new Set<() => void>();
let summary: FrameSummary | null = null;

export function publishFrameStats(sample: FrameStatsSample | null): void {
  if (sample) {
    summary = window5s.push(sample, performance.now());
  } else {
    window5s.clear();
    summary = null;
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export const usePerfSummary = () => useSyncExternalStore(subscribe, () => summary, () => null);
