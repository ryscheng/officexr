import { useMediaQuery } from './useMediaQuery.ts';

/**
 * Whether the device is held upright. A phone with its keyboard open can have a viewport wider than tall while
 * still held upright, so the screen's own shape (`device-aspect-ratio`, which a keyboard does not change) counts too.
 */
export function usePortrait(): boolean {
  const viewportPortrait = useMediaQuery('(orientation: portrait)');
  const screenMatches = useMediaQuery('(device-aspect-ratio: 9/16), (max-device-aspect-ratio: 1/1)');
  return viewportPortrait || screenMatches;
}
