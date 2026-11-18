import { describe, expect, it } from 'vitest';
import { appearanceFor, facingOf } from './topDownCharacter.ts';
import { PlayerMotion, STILL } from './topDownMotion.ts';

const at = (x: number, z: number) => ({ pos: { x, y: 0, z } });

describe('PlayerMotion', () => {
  it('is still until a player has moved for a moment, then walks', () => {
    const motion = new PlayerMotion();
    motion.update({ a: at(0, 0) }, 0.016);
    expect(motion.sample('a')).toEqual(STILL);
    for (let i = 1; i <= 20; i++) {
      motion.update({ a: at(i * 0.03, 0) }, 0.016);
    }
    const walking = motion.sample('a');
    expect(walking.moving).toBe(true);
    expect(walking.phase).toBeGreaterThan(0);
  });

  it('settles back to standing when the player stops', () => {
    const motion = new PlayerMotion();
    for (let i = 0; i <= 20; i++) {
      motion.update({ a: at(i * 0.03, 0) }, 0.016);
    }
    for (let i = 0; i < 60; i++) {
      motion.update({ a: at(0.6, 0) }, 0.016);
    }
    expect(motion.sample('a').moving).toBe(false);
  });

  it('forgets players who left', () => {
    const motion = new PlayerMotion();
    motion.update({ a: at(0, 0) }, 0.016);
    motion.update({ a: at(1, 0) }, 0.016);
    motion.update({}, 0.016);
    expect(motion.sample('a')).toEqual(STILL);
  });
});

describe('character look', () => {
  it('faces the way the yaw points, yaw 0 being up the screen', () => {
    expect(facingOf(0)).toBe('up');
    expect(facingOf(Math.PI)).toBe('down');
    expect(facingOf(Math.PI / 2)).toBe('left');
    expect(facingOf(-Math.PI / 2)).toBe('right');
  });

  it('gives one person the same look in every window', () => {
    expect(appearanceFor('ana@x.co#1')).toEqual(appearanceFor('ana@x.co#2'));
  });
});
