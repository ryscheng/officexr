import type { SoundId } from './cues.ts';

export type OneShotSynth = (ctx: AudioContext, out: AudioNode, t: number, noise: AudioBuffer) => void;

function envelope(ctx: AudioContext, out: AudioNode, t: number, peak: number, attack: number, length: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  g.connect(out);
  return g;
}

function tone(ctx: AudioContext, out: AudioNode, t: number, type: OscillatorType, from: number, to: number, peak: number, length: number, delay = 0): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t + delay);
  osc.frequency.exponentialRampToValueAtTime(to, t + delay + length);
  osc.connect(envelope(ctx, out, t + delay, peak, 0.008, length));
  osc.start(t + delay);
  osc.stop(t + delay + length + 0.02);
}

function noiseBurst(
  ctx: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  filter: BiquadFilterType,
  from: number,
  to: number,
  peak: number,
  length: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + length);
  src.connect(f).connect(envelope(ctx, out, t, peak, 0.01, length));
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

export const ONE_SHOTS: Partial<Record<SoundId, OneShotSynth>> = {
  'wand-pickup': (ctx, out, t) => {
    tone(ctx, out, t, 'sine', 660, 1320, 0.28, 0.18);
    tone(ctx, out, t, 'triangle', 1320, 1980, 0.14, 0.22, 0.08);
  },
  'wand-putback': (ctx, out, t) => {
    tone(ctx, out, t, 'sine', 990, 440, 0.26, 0.2);
    tone(ctx, out, t, 'triangle', 660, 330, 0.12, 0.2, 0.06);
  },
  cast: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, noise, t, 'bandpass', 500, 2600, 0.5, 0.38);
    tone(ctx, out, t, 'sine', 420, 980, 0.1, 0.3);
  },
  'fire-explosion': (ctx, out, t, noise) => {
    noiseBurst(ctx, out, noise, t, 'lowpass', 2400, 140, 0.9, 0.7);
    tone(ctx, out, t, 'sine', 110, 38, 0.8, 0.5);
  },
  poof: (ctx, out, t, noise) => noiseBurst(ctx, out, noise, t, 'lowpass', 900, 200, 0.5, 0.2),
  sparkle: (ctx, out, t) => {
    [2100, 2800, 3500, 2500].forEach((hz, i) => tone(ctx, out, t, 'sine', hz, hz * 1.2, 0.12, 0.12, i * 0.045));
  },
  poke: (ctx, out, t) => tone(ctx, out, t, 'triangle', 340, 200, 0.3, 0.07),
  mount: (ctx, out, t) => {
    tone(ctx, out, t, 'square', 1800, 900, 0.1, 0.03);
    tone(ctx, out, t, 'square', 1300, 700, 0.08, 0.04, 0.05);
  },
  splash: (ctx, out, t, noise) => {
    noiseBurst(ctx, out, noise, t, 'bandpass', 900, 1700, 0.7, 0.45);
    noiseBurst(ctx, out, noise, t + 0.08, 'highpass', 2500, 1500, 0.25, 0.3);
  },
  'swim-stroke': (ctx, out, t, noise) => noiseBurst(ctx, out, noise, t, 'bandpass', 700, 1100, 0.3, 0.28),
};

export type LoopSynth = (ctx: AudioContext, noise: AudioBuffer) => AudioNode;

export const LOOP_SYNTH: Partial<Record<SoundId, { filter: BiquadFilterType; hz: number; q: number; crackle: boolean }>> = {
  'fire-crackle': { filter: 'highpass', hz: 1800, q: 0.7, crackle: true },
  wheel: { filter: 'bandpass', hz: 420, q: 0.8, crackle: false },
};

export function createNoise(ctx: AudioContext, seconds = 1.5): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createCrackle(ctx: AudioContext, seconds = 1.2): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let level = 0;
  for (let i = 0; i < data.length; i++) {
    if (Math.random() < 0.0009) level = 0.5 + Math.random() * 0.5;
    level *= 0.996;
    data[i] = (Math.random() * 2 - 1) * (0.08 + level);
  }
  return buffer;
}
