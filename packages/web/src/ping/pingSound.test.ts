import { describe, expect, it, vi } from 'vitest';
import { soundAssetUrl } from '@officexr/world/app';
import { createPingPlayer } from './pingSound';

function setup(playImpl: () => Promise<void> = () => Promise.resolve()) {
  const oscillators: unknown[] = [];
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  const node = { connect: (next: unknown) => next };
  const context: { state: string; [k: string]: unknown } = {
    currentTime: 0,
    destination: {},
    state: 'suspended',
    resume: vi.fn(() => {
      context.state = 'running';
      return Promise.resolve();
    }),
    createOscillator: () => {
      const osc = { ...node, frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    },
    createGain: () => ({ ...node, gain: param }),
  };
  const audioSrcs: string[] = [];
  const gestureTarget = new EventTarget();
  const player = createPingPlayer({
    createAudioContext: () => context as unknown as AudioContext,
    createAudio: (src) => {
      audioSrcs.push(src);
      return { play: playImpl };
    },
    gestureTarget,
  });
  return { player, oscillators, audioSrcs, context, gestureTarget };
}

const catalog = { sounds: [{ name: 'bell', size: 1, updatedAt: 1 }] };

describe('createPingPlayer', () => {
  it('plays a two-tone chime for builtin', () => {
    const { player, oscillators, audioSrcs } = setup();
    player.play({ type: 'builtin' });
    expect(oscillators).toHaveLength(2);
    expect(audioSrcs).toEqual([]);
  });

  it('plays nothing for none', () => {
    const { player, oscillators, audioSrcs } = setup();
    player.play({ type: 'none' });
    expect(oscillators).toHaveLength(0);
    expect(audioSrcs).toEqual([]);
  });

  it('plays a library sound through an audio element', () => {
    const { player, oscillators, audioSrcs } = setup();
    player.play({ type: 'library', name: 'bell' }, catalog);
    expect(audioSrcs).toEqual([soundAssetUrl('bell')]);
    expect(oscillators).toHaveLength(0);
  });

  it('tries a library sound before the catalog has loaded', () => {
    const { player, audioSrcs } = setup();
    player.play({ type: 'library', name: 'bell' }, null);
    expect(audioSrcs).toEqual([soundAssetUrl('bell')]);
  });

  it('falls back to builtin for a name missing from the catalog', () => {
    const { player, oscillators, audioSrcs } = setup();
    player.play({ type: 'library', name: 'gone.mp3' }, catalog);
    expect(audioSrcs).toEqual([]);
    expect(oscillators).toHaveLength(2);
  });

  it('falls back to builtin when the audio fails to play', async () => {
    const { player, oscillators } = setup(() => Promise.reject(new Error('load failed')));
    player.play({ type: 'library', name: 'bell' }, catalog);
    await vi.waitFor(() => expect(oscillators).toHaveLength(2));
  });

  it('arms the gesture unlock at construction, before any ping, and stops once running', async () => {
    const { context, gestureTarget } = setup();
    gestureTarget.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    gestureTarget.dispatchEvent(new Event('keydown'));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});
