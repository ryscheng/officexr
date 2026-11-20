import { colorBurst } from './color-burst.ts';
import { fireball } from './fireball.ts';
import { levitate } from './levitate.ts';
import { shrink } from './shrink.ts';
import type { SpellStrategy, SpellVisual } from './types.ts';

export * from './types.ts';

/** Order is the hotkey order; the first entry is the default spell. */
export const SPELLS = { fireball, levitate, shrink, 'color-burst': colorBurst } as const satisfies Record<string, SpellStrategy>;

export type SpellId = keyof typeof SPELLS;
export const SPELL_IDS = Object.keys(SPELLS) as [SpellId, ...SpellId[]];
export const DEFAULT_SPELL: SpellId = SPELL_IDS[0];

export const isSpellId = (value: unknown): value is SpellId =>
  typeof value === 'string' && Object.hasOwn(SPELLS, value);

export const SPELL_RANGE_M = 10;
export const SPELL_COOLDOWN_MS = 1000;
export const SPELL_HIT_RADIUS_M = 0.55;

export interface SpellCast {
  spell: SpellId;
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  /** How far the bolt flies before it lands, in metres. */
  distance: number;
  targetId: string | null;
}

/** Times are on the session clock (`performance.now()` in the web client), the same one every reader of them must use. */
export interface SpellEffect {
  spell: SpellId;
  casterId: string;
  startsAt: number;
  endsAt: number;
}

export const travelMs = (spell: SpellId, distance: number) => (distance / SPELLS[spell].projectile.speedMps) * 1000;

export function effectFromCast(casterId: string, cast: SpellCast, now: number): SpellEffect {
  const startsAt = now + travelMs(cast.spell, cast.distance);
  return { spell: cast.spell, casterId, startsAt, endsAt: startsAt + SPELLS[cast.spell].durationMs };
}

export const cycleSpell = (current: SpellId, step: 1 | -1): SpellId =>
  SPELL_IDS[(SPELL_IDS.indexOf(current) + step + SPELL_IDS.length) % SPELL_IDS.length];

export function spellForDigit(key: string): SpellId | null {
  const index = Number(key) - 1;
  return Number.isInteger(index) ? (SPELL_IDS[index] ?? null) : null;
}

export function pickSpellTarget(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  others: readonly { id: string; x: number; y: number; z: number }[],
  maxDistance: number,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const o of others) {
    const px = o.x - origin.x;
    const py = o.y - origin.y;
    const pz = o.z - origin.z;
    const along = px * dir.x + py * dir.y + pz * dir.z;
    if (along < 0 || along > maxDistance) continue;
    const perp = Math.hypot(px - dir.x * along, py - dir.y * along, pz - dir.z * along);
    if (perp <= SPELL_HIT_RADIUS_M && (!best || along < best.distance)) best = { id: o.id, distance: along };
  }
  return best;
}

export function activeEffect(effects: Record<string, SpellEffect>, playerId: string, now: number): SpellEffect | null {
  const effect = effects[playerId];
  return effect && now < effect.endsAt ? effect : null;
}

export function currentVisual(effects: Record<string, SpellEffect>, playerId: string, now: number): SpellVisual | null {
  const effect = activeEffect(effects, playerId, now);
  return effect && now >= effect.startsAt ? SPELLS[effect.spell].visual(now - effect.startsAt) : null;
}
