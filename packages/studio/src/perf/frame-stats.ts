/**
 * Studio-side frame-stats bus. The single bridge between R3F canvases
 * (which publish `FrameStatsSample`s from inside the frame loop via
 * `<FrameStatsProbe>` / Scene's `onFrameStats`) and DOM UI outside the
 * canvas (the `<PerfFooter>` at the bottom of `StudioPage`).
 *
 * Same module-level pub/sub shape as the `BakeRegistry` the
 * `BakeStatusBar` consumes: one mutable current value, a Set of
 * listeners, and a `useSyncExternalStore` hook for React consumers.
 * Only one canvas is ever mounted at a time (switching studio modes
 * unmounts the previous app), so a single current-sample slot is
 * sufficient — the unmounting probe publishes `null`, clearing the
 * readout until the next canvas's first sample lands.
 */

import { useSyncExternalStore } from 'react';
import type { FrameStatsSample } from '@officexr/world/renderer';

let current: FrameStatsSample | null = null;
const listeners = new Set<() => void>();

/** Publish a new sample (or `null` when the producing canvas unmounts). */
export function publishFrameStats(sample: FrameStatsSample | null): void {
  current = sample;
  for (const l of listeners) l();
}

export function getFrameStats(): FrameStatsSample | null {
  return current;
}

export function subscribeFrameStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: the latest sample, or `null` when no canvas is reporting. */
export function useFrameStats(): FrameStatsSample | null {
  return useSyncExternalStore(subscribeFrameStats, getFrameStats);
}
