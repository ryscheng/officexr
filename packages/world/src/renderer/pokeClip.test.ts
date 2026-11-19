import { describe, expect, it } from 'vitest';
import { createPokeClip, POKE_CLIP_DURATION, POKE_CLIP_NAME } from './pokeClip.ts';

describe('createPokeClip', () => {
  const clip = createPokeClip();

  it('drives only the right arm, with the bone names the rig uses once GLTFLoader strips the dots', () => {
    expect(clip.name).toBe(POKE_CLIP_NAME);
    expect(clip.tracks.map((t) => t.name).sort()).toEqual(['lowerarmr.quaternion', 'upperarmr.quaternion']);
  });

  it('starts and ends in the resting arm pose and reaches out in between', () => {
    const upper = clip.tracks.find((t) => t.name.startsWith('upperarmr'))!;
    const frame = (i: number) => Array.from(upper.values.slice(i * 4, i * 4 + 4));
    expect(upper.times[upper.times.length - 1]).toBeCloseTo(POKE_CLIP_DURATION);
    expect(frame(0)).toEqual(frame(3));
    expect(frame(1)).not.toEqual(frame(0));
    expect(frame(1)).toEqual(frame(2));
  });
});
