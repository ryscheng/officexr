import { describe, expect, it } from 'vitest';
import {
  activeEffect,
  currentVisual,
  cycleSpell,
  DEFAULT_SPELL,
  effectFromCast,
  isSpellId,
  pickSpellTarget,
  SPELL_IDS,
  SPELLS,
  spellForDigit,
  travelMs,
  type SpellCast,
} from './index.ts';

const cast: SpellCast = {
  spell: 'fireball',
  origin: { x: 0, y: 1, z: 0 },
  dir: { x: 0, y: 0, z: 1 },
  distance: 8,
  targetId: 'b',
};

describe('spell registry', () => {
  it('starts with fireball and gives every spell a visual that is neutral outside its window', () => {
    expect(DEFAULT_SPELL).toBe('fireball');
    expect(SPELL_IDS).toEqual(['fireball', 'levitate', 'shrink', 'color-burst']);
    for (const id of SPELL_IDS) {
      const spell = SPELLS[id];
      expect(spell.durationMs).toBeGreaterThan(0);
      const end = spell.visual(spell.durationMs);
      expect(end.lift).toBeCloseTo(0, 5);
      expect(end.scale).toBeCloseTo(1, 5);
      expect(end.tintStrength).toBeCloseTo(0, 5);
    }
  });

  it('fireball singes for about three seconds with a hop and smoke', () => {
    const v = SPELLS.fireball;
    expect(v.durationMs).toBe(3000);
    expect(v.visual(200).lift).toBeGreaterThan(0.2);
    expect(v.visual(1500)).toMatchObject({ lift: 0, smoke: true, soot: 1 });
    expect(v.visual(1500).tintStrength).toBeGreaterThan(0.5);
    expect(v.projectile.speedMps).toBe(8);
  });

  it('levitate lifts about a metre and freezes movement, shrink halves, color burst tints', () => {
    expect(SPELLS.levitate.visual(2500).lift).toBeGreaterThan(0.85);
    expect(SPELLS.levitate.visual(2500).moveSpeedScale).toBe(0);
    expect(SPELLS.shrink.visual(2500).scale).toBe(0.5);
    expect(SPELLS['color-burst'].visual(1000)).toMatchObject({ sparkles: true });
    expect(SPELLS['color-burst'].visual(1000).tint).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('picks spells by digit and cycles around', () => {
    expect(spellForDigit('1')).toBe('fireball');
    expect(spellForDigit('4')).toBe('color-burst');
    expect(spellForDigit('5')).toBeNull();
    expect(spellForDigit('x')).toBeNull();
    expect(cycleSpell('color-burst', 1)).toBe('fireball');
    expect(cycleSpell('fireball', -1)).toBe('color-burst');
    expect(isSpellId('fireball')).toBe(true);
    expect(isSpellId('toString')).toBe(false);
  });
});

describe('spell targeting and timing', () => {
  const dir = { x: 0, y: 0, z: 1 };
  const origin = { x: 0, y: 1, z: 0 };

  it('hits the nearest body on the ray and ignores one beside it, behind it or out of range', () => {
    const hit = pickSpellTarget(
      origin,
      dir,
      [
        { id: 'far', x: 0, y: 1, z: 7 },
        { id: 'near', x: 0.3, y: 1, z: 3 },
        { id: 'side', x: 2, y: 1, z: 3 },
        { id: 'behind', x: 0, y: 1, z: -2 },
        { id: 'out', x: 0, y: 1, z: 12 },
      ],
      10,
    );
    expect(hit).toEqual({ id: 'near', distance: 3 });
    expect(pickSpellTarget(origin, dir, [{ id: 'x', x: 0, y: 1, z: 6 }], 5)).toBeNull();
  });

  it('starts the effect when the bolt lands and expires it after the duration', () => {
    expect(travelMs('fireball', 8)).toBe(1000);
    const effect = effectFromCast('a', cast, 5000);
    expect(effect).toEqual({ spell: 'fireball', casterId: 'a', startsAt: 6000, endsAt: 9000 });
    expect(activeEffect({ b: effect }, 'b', 8999)).toBe(effect);
    expect(activeEffect({ b: effect }, 'b', 9000)).toBeNull();
    expect(activeEffect({ b: effect }, 'c', 6500)).toBeNull();
  });

  it('shows the effect only while it runs', () => {
    const effects = { b: effectFromCast('a', cast, 0) };
    expect(currentVisual(effects, 'b', 500)).toBeNull();
    expect(currentVisual(effects, 'b', 1200)?.smoke).toBe(true);
    expect(currentVisual(effects, 'b', 4000)).toBeNull();
    expect(currentVisual(effects, 'c', 1200)).toBeNull();
  });
});
