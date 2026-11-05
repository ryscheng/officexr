import { describe, expect, it, vi } from 'vitest';
import { createPingPlayer } from './pingSound';

function setup(playImpl: () => Promise<void> = () => Promise.resolve()) {
  const oscillators: unknown[] = [];
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  const node = { connect: (next: unknown) => next };
  const context = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
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

const catalog = { sounds: [{ name: 'bell.mp3', size: 1, updatedAt: 1 }] };

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
    player.play({ type: 'library', name: 'bell.mp3' }, catalog);
    expect(audioSrcs).toHaveLength(1);
    expect(audioSrcs[0]).toContain('bell.mp3');
    expect(oscillators).toHaveLength(0);
  });

  it('falls back to builtin for a name missing from the catalog', () => {
    const { player, oscillators, audioSrcs } = setup();
    player.play({ type: 'library', name: 'gone.mp3' }, catalog);
    expect(audioSrcs).toEqual([]);
    expect(oscillators).toHaveLength(2);
  });

  it('falls back to builtin when the audio fails to play', async () => {
    const { player, oscillators } = setup(() => Promise.reject(new Error('load failed')));
    player.play({ type: 'library', name: 'bell.mp3' }, catalog);
    await vi.waitFor(() => expect(oscillators).toHaveLength(2));
  });

  it('resumes the audio context on the first gesture', () => {
    const { context, gestureTarget } = setup();
    gestureTarget.dispatchEvent(new Event('pointerdown'));
    gestureTarget.dispatchEvent(new Event('keydown'));
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});
