import type { Vec3 } from '@officexr/sdk';
import { distanceGain, type SoundCue, type SoundId } from './cues.ts';
import { createCrackle, createNoise, LOOP_SYNTH, ONE_SHOTS } from './synth.ts';

export interface SfxSettings {
  enabled: boolean;
  volume: number;
}

export interface SfxEngineDeps {
  createContext(): AudioContext;
  gestureTarget: EventTarget;
  settings(): SfxSettings;
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
const LOOP_IDLE_STOP_MS = 600;
const MASTER_GAIN = 0.55;

interface LoopVoice {
  gain: GainNode;
  source: AudioBufferSourceNode;
  idleSince: number | null;
}

// The audio output cannot be tested headlessly; the cue selection that feeds it (`cues.ts`) is.
export class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBuffer | null = null;
  private unlocked = false;
  private listener: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly loops = new Map<string, LoopVoice>();
  private readonly unlock = () => {
    this.unlocked = true;
    const ctx = this.ensureContext();
    void ctx.resume().then(() => {
      if (ctx.state === 'running') GESTURES.forEach((type) => this.deps.gestureTarget.removeEventListener(type, this.unlock));
    }, () => {});
  };

  constructor(private readonly deps: SfxEngineDeps) {
    GESTURES.forEach((type) => deps.gestureTarget.addEventListener(type, this.unlock));
  }

  setListener(at: Vec3): void {
    this.listener = at;
  }

  play(cue: SoundCue): void {
    const settings = this.deps.settings();
    if (!settings.enabled || settings.volume <= 0) {
      this.stopLoops();
      return;
    }
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') return;
    if (cue.type === 'shot') {
      this.shot(ctx, cue.sound, distanceGain(this.listener, cue.at) * cue.gain * settings.volume);
    } else {
      this.loop(ctx, cue.key, cue.sound, distanceGain(this.listener, cue.at) * cue.level * settings.volume);
    }
  }

  /** Silences every loop at once when sound is turned off, even if no further cue arrives. */
  tick(): void {
    const settings = this.deps.settings();
    if (!settings.enabled || settings.volume <= 0) this.stopLoops();
  }

  dispose(): void {
    GESTURES.forEach((type) => this.deps.gestureTarget.removeEventListener(type, this.unlock));
    for (const voice of this.loops.values()) voice.source.stop();
    this.loops.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  private stopLoops(): void {
    for (const voice of this.loops.values()) voice.source.stop();
    this.loops.clear();
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.deps.createContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.noise = createNoise(this.ctx);
      this.crackle = createCrackle(this.ctx);
    }
    return this.ctx;
  }

  private shot(ctx: AudioContext, sound: SoundId, gain: number): void {
    const synth = ONE_SHOTS[sound];
    if (!synth || gain < 0.01 || !this.master || !this.noise) return;
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    synth(ctx, out, ctx.currentTime, this.noise);
  }

  private loop(ctx: AudioContext, key: string, sound: SoundId, gain: number): void {
    const recipe = LOOP_SYNTH[sound];
    if (!recipe || !this.master) return;
    let voice = this.loops.get(key);
    if (!voice && gain < 0.01) return;
    if (!voice) {
      const source = ctx.createBufferSource();
      source.buffer = recipe.crackle ? this.crackle : this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = recipe.filter;
      filter.frequency.value = recipe.hz;
      filter.Q.value = recipe.q;
      const g = ctx.createGain();
      g.gain.value = 0;
      source.connect(filter).connect(g).connect(this.master);
      source.start();
      voice = { gain: g, source, idleSince: null };
      this.loops.set(key, voice);
    }
    voice.gain.gain.setTargetAtTime(gain * 0.6, ctx.currentTime, 0.05);
    if (gain >= 0.01) {
      voice.idleSince = null;
      return;
    }
    voice.idleSince ??= performance.now();
    const quiet = voice;
    setTimeout(() => {
      if (this.loops.get(key) === quiet && quiet.idleSince !== null) {
        quiet.source.stop();
        this.loops.delete(key);
      }
    }, LOOP_IDLE_STOP_MS);
  }
}
