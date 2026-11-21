import { useSyncExternalStore } from 'react';
import { useMediaQuery } from './useMediaQuery.ts';

function subscribe(onChange: () => void): () => void {
  const orientation = window.screen.orientation;
  orientation?.addEventListener('change', onChange);
  return () => orientation?.removeEventListener('change', onChange);
}

const screenIsUpright = () => window.screen.orientation?.type.startsWith('portrait') ?? false;

// An open keyboard can make the viewport wider than tall while the phone is still upright.
export function usePortrait(): boolean {
  const viewportPortrait = useMediaQuery('(orientation: portrait)');
  const screenPortrait = useSyncExternalStore(subscribe, screenIsUpright, () => false);
  return viewportPortrait || screenPortrait;
}
