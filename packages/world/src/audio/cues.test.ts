import { describe, expect, it } from 'vitest';
import { boltLoopCue, castCues, distanceGain, impactCues, pokeCue, SOUND_IDS, SOUND_MAX_DISTANCE_M, SoundDirector, type SoundActor } from './cues.ts';
import { LOOP_SYNTH, ONE_SHOTS } from './synth.ts';

const at = (x: number, z = 0) => ({ x, y: 0, z });
const actor = (patch: Partial<SoundActor> = {}): SoundActor => ({ pos: at(0), vel: at(0), ...patch });
const sounds = (cues: ReturnType<SoundDirector['frame']>) => cues.map((c) => (c.type === 'shot' ? c.sound : `loop:${c.sound}:${c.level.toFixed(1)}`));

describe('distance gain', () => {
  it('is full up close, falls with distance, and is silent beyond the maximum', () => {
    expect(distanceGain(at(0), at(0))).toBe(1);
    expect(distanceGain(at(0), at(SOUND_MAX_DISTANCE_M / 2))).toBeCloseTo(0.25);
    expect(distanceGain(at(0), at(SOUND_MAX_DISTANCE_M))).toBe(0);
    expect(distanceGain(at(0), at(SOUND_MAX_DISTANCE_M * 3))).toBe(0);
    expect(distanceGain(at(0), at(5))).toBeGreaterThan(distanceGain(at(0), at(15)));
  });

  it('keeps a sound with no position at full gain', () => {
    expect(distanceGain(at(100), null)).toBe(1);
  });
});

describe('spell sounds', () => {
  const cast = { spell: 'fireball' as const, origin: at(1), dir: at(0, 1), distance: 6, targetId: 'b' };

  it('whooshes at the wand tip', () => {
    expect(castCues(cast)).toEqual([{ type: 'shot', sound: 'cast', at: cast.origin, gain: 1 }]);
  });

  it('explodes a fireball where it lands and poofs the singed target', () => {
    expect(sounds(impactCues('fireball', at(5), at(5)))).toEqual(['fire-explosion', 'poof']);
    expect(sounds(impactCues('fireball', at(5), null))).toEqual(['fire-explosion']);
  });

  it('sparkles for the other spells, with no explosion', () => {
    for (const spell of ['levitate', 'shrink', 'color-burst'] as const) expect(sounds(impactCues(spell, at(5), at(5)))).toEqual(['sparkle']);
  });

  it('crackles only while a fireball flies', () => {
    expect(boltLoopCue('1', 'fireball', at(2), true)).toMatchObject({ key: 'bolt:1', sound: 'fire-crackle', level: 0.7 });
    expect(boltLoopCue('1', 'fireball', at(2), false)).toMatchObject({ level: 0 });
    expect(boltLoopCue('1', 'shrink', at(2), true)).toBeNull();
  });

  it('taps for a poke', () => {
    expect(pokeCue(at(1))).toMatchObject({ sound: 'poke', at: at(1) });
  });
});

describe('SoundDirector', () => {
  it('plays nothing for players it sees for the first time', () => {
    const d = new SoundDirector();
    expect(d.frame({ a: actor({ held: 'wand', pose: 'swim' }) }, 0)).toEqual([]);
  });

  it('plays the pick-up and put-back sounds on the hand changing', () => {
    const d = new SoundDirector();
    d.frame({ a: actor() }, 0);
    expect(sounds(d.frame({ a: actor({ held: 'wand' }) }, 16))).toEqual(['wand-pickup']);
    expect(d.frame({ a: actor({ held: 'wand' }) }, 32)).toEqual([]);
    expect(sounds(d.frame({ a: actor({ held: null }) }, 48))).toEqual(['wand-putback']);
  });

  it('clicks on mounting and dismounting, and splashes entering and leaving water', () => {
    const d = new SoundDirector();
    d.frame({ a: actor() }, 0);
    expect(sounds(d.frame({ a: actor({ pose: 'scooter' }) }, 16))).toEqual(['mount']);
    expect(sounds(d.frame({ a: actor({ pose: null }) }, 32))).toEqual(['mount']);
    expect(sounds(d.frame({ a: actor({ pose: 'swim' }) }, 48))).toEqual(['splash']);
    const out = d.frame({ a: actor({ pose: null }) }, 64);
    expect(sounds(out)).toEqual(['splash']);
    expect(out[0]).toMatchObject({ gain: 0.6 });
  });

  it('strokes while swimming at speed, no faster than the stroke gap', () => {
    const d = new SoundDirector();
    d.frame({ a: actor({ pose: 'swim' }) }, 0);
    const swimming = { a: actor({ pose: 'swim', vel: at(2) }) };
    expect(sounds(d.frame(swimming, 100))).toEqual(['swim-stroke']);
    expect(d.frame(swimming, 400)).toEqual([]);
    expect(sounds(d.frame(swimming, 800))).toEqual(['swim-stroke']);
    expect(d.frame({ a: actor({ pose: 'swim' }) }, 2000)).toEqual([]);
  });

  it('runs a wheel loop that follows speed while riding and ends when the ride stops', () => {
    const d = new SoundDirector();
    d.frame({ a: actor({ pose: 'tricycle' }) }, 0);
    expect(sounds(d.frame({ a: actor({ pose: 'tricycle', vel: at(3) }) }, 16))).toEqual(['loop:wheel:0.5']);
    expect(sounds(d.frame({ a: actor({ pose: 'tricycle', vel: at(9) }) }, 32))).toEqual(['loop:wheel:1.0']);
    expect(sounds(d.frame({ a: actor({ pose: 'tricycle' }) }, 48))).toEqual(['loop:wheel:0.0']);
    expect(d.frame({ a: actor({ pose: 'tricycle' }) }, 64)).toEqual([]);
  });

  it('stops the wheel loop of a rider who left the room', () => {
    const d = new SoundDirector();
    d.frame({ a: actor({ pose: 'scooter' }) }, 0);
    d.frame({ a: actor({ pose: 'scooter', vel: at(5) }) }, 16);
    expect(sounds(d.frame({}, 32))).toEqual(['loop:wheel:0.0']);
  });
});

describe('synth table', () => {
  it('has a one-shot or a loop recipe for every sound id', () => {
    for (const id of SOUND_IDS) expect(Boolean(ONE_SHOTS[id] ?? LOOP_SYNTH[id]), id).toBe(true);
  });

  it('never gives a sound both recipes', () => {
    for (const id of SOUND_IDS) expect(ONE_SHOTS[id] && LOOP_SYNTH[id], id).toBeFalsy();
  });
});
