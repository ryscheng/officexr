import { SfxEngine } from '@officexr/world/audio';
import { readSfxPrefs } from './sfxPrefs';

/** The office's sound effects: Web Audio, silent until the first click or key, following the player's sound settings. */
export const createBrowserSfx = (): SfxEngine =>
  new SfxEngine({
    createContext: () => new AudioContext(),
    gestureTarget: window,
    settings: () => readSfxPrefs(localStorage),
  });
