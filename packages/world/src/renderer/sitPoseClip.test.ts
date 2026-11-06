import { describe, expect, it } from 'vitest';
import { createSitPoseClip, SIT_CLIP_NAME } from './sitPoseClip.ts';

describe('createSitPoseClip', () => {
  const clip = createSitPoseClip();

  it('is named for the seated idle', () => {
    expect(clip.name).toBe(SIT_CLIP_NAME);
  });

  it('keys only leg, spine and arm bones, never the root or hips', () => {
    const bones = clip.tracks.map((t) => t.name.replace(/\.quaternion$/, '')).sort();
    expect(bones).toEqual([
      'footl',
      'footr',
      'lowerarml',
      'lowerarmr',
      'lowerlegl',
      'lowerlegr',
      'spine',
      'upperarml',
      'upperarmr',
      'upperlegl',
      'upperlegr',
    ]);
  });

  it('holds one constant pose over two keyframes', () => {
    for (const track of clip.tracks) {
      expect(track.name.endsWith('.quaternion')).toBe(true);
      expect(track.times).toHaveLength(2);
      const values = Array.from(track.values);
      expect(values.slice(0, 4)).toEqual(values.slice(4));
    }
  });
});
