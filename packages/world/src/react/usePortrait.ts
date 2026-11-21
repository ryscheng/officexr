import { useSyncExternalStore } from 'react';
import { useMediaQuery } from './useMediaQuery.ts';

function subscribe(onChange: () => void): () => void {
  const orientation = window.screen.orientation;
  orientation?.addEventListener('change', onChange);
  return () => orientation?.removeEventListener('change', onChange);
}

const screenIsUpright = () => window.screen.orientation?.type.startsWith('portrait') ?? false;

/**
 * Whether the device is held upright. A phone with its keyboard open can have a viewport wider than tall while
 * still held upright, so the screen's own orientation counts as well as the viewport's.
 */
export function usePortrait(): boolean {
  const viewportPortrait = useMediaQuery('(orientation: portrait)');
  const screenPortrait = useSyncExternalStore(subscribe, screenIsUpright, () => false);
  return viewportPortrait || screenPortrait;
}
