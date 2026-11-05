import { soundAssetUrl, type SoundCatalog } from '@officexr/world/app';
import type { PingSound } from './pingPrefs';

export interface PingSoundDeps {
  createAudioContext(): AudioContext;
  createAudio(src: string): Pick<HTMLAudioElement, 'play'>;
  /** Where the first user gesture is heard, to unlock a context the browser started suspended. */
  gestureTarget: EventTarget;
}

export interface PingPlayer {
  /** Plays the sound; a library sound missing from `catalog` (when given) or failing to load plays the builtin. */
  play(sound: PingSound, catalog?: SoundCatalog | null): void;
}

const GESTURES = ['pointerdown', 'keydown'];
const CHIME = [
  { hz: 880, at: 0 },
  { hz: 1175, at: 0.15 },
];

export function createPingPlayer(deps: PingSoundDeps): PingPlayer {
  let context: AudioContext | null = null;
  const audioContext = () => (context ??= deps.createAudioContext());

  const unlock = () => {
    GESTURES.forEach((gesture) => deps.gestureTarget.removeEventListener(gesture, unlock));
    void audioContext().resume();
  };
  GESTURES.forEach((gesture) => deps.gestureTarget.addEventListener(gesture, unlock));

  const chime = () => {
    const ctx = audioContext();
    const start = ctx.currentTime;
    for (const { hz, at } of CHIME) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.3);
    }
  };

  return {
    play(sound, catalog) {
      if (sound.type === 'none') {
        return;
      }
      if (sound.type === 'builtin' || (catalog && !catalog.sounds.some((s) => s.name === sound.name))) {
        chime();
        return;
      }
      try {
        void Promise.resolve(deps.createAudio(soundAssetUrl(sound.name)).play()).catch(chime);
      } catch {
        chime();
      }
    },
  };
}

let browserPlayer: PingPlayer | null = null;

const getBrowserPlayer = (): PingPlayer =>
  (browserPlayer ??= createPingPlayer({
    createAudioContext: () => new AudioContext(),
    createAudio: (src) => new Audio(src),
    gestureTarget: window,
  }));

export const playPingSound = (sound: PingSound, catalog?: SoundCatalog | null): void => getBrowserPlayer().play(sound, catalog);

export const previewPingSound = (sound: PingSound, catalog?: SoundCatalog | null): void => playPingSound(sound, catalog);
