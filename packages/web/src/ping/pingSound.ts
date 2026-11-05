import { soundAssetUrl, type SoundCatalog } from '@officexr/world/app';
import { resumeOnGesture } from '../voice/resumeOnGesture';
import type { PingSound } from './pingPrefs';
import { assertNever } from './assertNever';

export interface PingSoundDeps {
  createAudioContext(): AudioContext;
  createAudio(src: string): { play(): Promise<void> };
  /** Where the first user gesture is heard, to unlock a context the browser started suspended. */
  gestureTarget: EventTarget;
}

export interface PingPlayer {
  /** Plays the sound; a library sound missing from `catalog` (when given) or failing to load plays the builtin. */
  play(sound: PingSound, catalog?: SoundCatalog | null): void;
}

const CHIME = [
  { hz: 880, at: 0 },
  { hz: 1175, at: 0.15 },
];

export function createPingPlayer(deps: PingSoundDeps): PingPlayer {
  const context = deps.createAudioContext();
  resumeOnGesture(context, deps.gestureTarget);

  const chime = () => {
    const ctx = context;
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
      switch (sound.type) {
        case 'none':
          return;
        case 'builtin':
          return chime();
        case 'library':
          if (catalog && !catalog.sounds.some((s) => s.name === sound.name)) {
            return chime();
          }
          deps.createAudio(soundAssetUrl(sound.name)).play().catch(chime);
          return;
        default:
          return assertNever(sound);
      }
    },
  };
}

let browserPlayer: PingPlayer | null = null;

export const browserPingPlayer = (): PingPlayer =>
  (browserPlayer ??= createPingPlayer({
    createAudioContext: () => new AudioContext(),
    createAudio: (src) => new Audio(src),
    gestureTarget: window,
  }));

export const previewPingSound = (sound: PingSound, catalog?: SoundCatalog | null): void =>
  browserPingPlayer().play(sound, catalog);
