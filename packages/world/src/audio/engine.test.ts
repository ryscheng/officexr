import { describe, expect, it } from 'vitest';
import { SfxEngine, type SfxSettings } from './engine.ts';

function fakeCtx() {
  const sources: { stopped: boolean; started: boolean }[] = [];
  const param = () => ({ value: 0, setTargetAtTime(v: number) { this.value = v; }, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect: (n: unknown) => n ?? {}, gain: param(), frequency: param(), Q: param(), type: '' });
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume() {
      this.state = 'running';
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
    createGain: () => node(),
    createBiquadFilter: () => node(),
    createOscillator: () => ({ ...node(), start() {}, stop() {} }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => {
      const s = { ...node(), buffer: null, loop: false, started: false, stopped: false, start() { s.started = true; }, stop() { s.stopped = true; } };
      sources.push(s);
      return s;
    },
  };
  return { ctx, sources };
}

const crackle = { type: 'loop' as const, key: 'bolt:1', sound: 'fire-crackle' as const, at: null, level: 0.7 };

function setup(initial: SfxSettings = { enabled: true, volume: 0.7 }) {
  const { ctx, sources } = fakeCtx();
  const target = new EventTarget();
  let settings = initial;
  let created = 0;
  const engine = new SfxEngine({
    createContext: () => {
      created++;
      return ctx as unknown as AudioContext;
    },
    gestureTarget: target,
    settings: () => settings,
  });
  return {
    engine,
    sources,
    created: () => created,
    set: (next: SfxSettings) => void (settings = next),
    unlock: async () => {
      target.dispatchEvent(new Event('keydown'));
      await Promise.resolve();
    },
  };
}

describe('SfxEngine loops and settings', () => {
  it('makes no audio context and plays nothing before the first gesture', async () => {
    const t = setup();
    t.engine.play(crackle);
    expect(t.created()).toBe(0);
    expect(t.sources).toHaveLength(0);
  });

  it('stops a running loop when sound is turned off and the loop sends its stop cue', async () => {
    const t = setup();
    await t.unlock();
    t.engine.play(crackle);
    const loop = t.sources.find((s) => s.started)!;
    expect(loop).toBeDefined();
    t.set({ enabled: false, volume: 0.7 });
    t.engine.play({ ...crackle, level: 0 });
    expect(loop.stopped).toBe(true);
  });

  it('stops a running loop when sound is turned off and no cue ever arrives again', async () => {
    const t = setup();
    await t.unlock();
    t.engine.play(crackle);
    const loop = t.sources.find((s) => s.started)!;
    t.set({ enabled: false, volume: 0.7 });
    t.engine.tick();
    expect(loop.stopped).toBe(true);
  });

  it('stops loops when the volume reaches zero, and does not start new ones while off', async () => {
    const t = setup();
    await t.unlock();
    t.engine.play(crackle);
    const loop = t.sources.find((s) => s.started)!;
    t.set({ enabled: true, volume: 0 });
    t.engine.play(crackle);
    expect(loop.stopped).toBe(true);
    expect(t.sources.filter((s) => s.started)).toHaveLength(1);
  });

  it('plays again once sound is turned back on', async () => {
    const t = setup();
    await t.unlock();
    t.set({ enabled: false, volume: 0.7 });
    t.engine.play(crackle);
    expect(t.sources.filter((s) => s.started)).toHaveLength(0);
    t.set({ enabled: true, volume: 0.7 });
    t.engine.play(crackle);
    expect(t.sources.filter((s) => s.started)).toHaveLength(1);
  });
});
