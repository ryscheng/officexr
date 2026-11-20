import { SfxEngine } from '@officexr/world/audio';
import { readSfxPrefs } from './sfxPrefs';

export const createBrowserSfx = (): SfxEngine =>
  new SfxEngine({
    createContext: () => new AudioContext(),
    gestureTarget: window,
    settings: () => readSfxPrefs(localStorage),
  });
