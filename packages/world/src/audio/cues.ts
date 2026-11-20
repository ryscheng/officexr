import type { HeldItem, PlayerPose, SpellCast, SpellId, Vec3 } from '@officexr/sdk';

export const SOUND_IDS = [
  'wand-pickup',
  'wand-putback',
  'cast',
  'fire-crackle',
  'fire-explosion',
  'poof',
  'sparkle',
  'poke',
  'mount',
  'wheel',
  'splash',
  'swim-stroke',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export type SoundCue =
  | { type: 'shot'; sound: SoundId; at: Vec3 | null; gain: number }
  | { type: 'loop'; key: string; sound: SoundId; at: Vec3 | null; level: number };

export const SOUND_MAX_DISTANCE_M = 26;

export function distanceGain(listener: Vec3, source: Vec3 | null): number {
  if (!source) return 1;
  const d = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const near = Math.max(0, 1 - d / SOUND_MAX_DISTANCE_M);
  return near * near;
}

const shot = (sound: SoundId, at: Vec3 | null, gain = 1): SoundCue => ({ type: 'shot', sound, at, gain });

export const castCues = (cast: SpellCast): SoundCue[] => [shot('cast', cast.origin)];

export function impactCues(spell: SpellId, landing: Vec3, target: Vec3 | null): SoundCue[] {
  if (spell === 'fireball') {
    return [shot('fire-explosion', landing), ...(target ? [shot('poof', target, 0.8)] : [])];
  }
  return [shot('sparkle', landing)];
}

export const boltLoopCue = (id: string, spell: SpellId, at: Vec3, flying: boolean): SoundCue | null =>
  spell === 'fireball' ? { type: 'loop', key: `bolt:${id}`, sound: 'fire-crackle', at, level: flying ? 0.7 : 0 } : null;

export const pokeCue = (at: Vec3): SoundCue => shot('poke', at, 0.8);

export interface SoundActor {
  pos: Vec3;
  vel: Vec3;
  pose?: PlayerPose | null;
  held?: HeldItem | null;
}

const STROKE_MIN_SPEED = 0.4;
const STROKE_GAP_MS = 650;
const RIDE_MIN_SPEED = 0.4;
const RIDE_FULL_SPEED = 6;

const isRide = (pose: PlayerPose | null | undefined) => pose === 'scooter' || pose === 'tricycle';

interface Memory {
  pose: PlayerPose | null;
  held: HeldItem | null;
  nextStrokeAt: number;
  riding: boolean;
}

export class SoundDirector {
  private readonly memory = new Map<string, Memory>();

  frame(players: Record<string, SoundActor>, now: number): SoundCue[] {
    const cues: SoundCue[] = [];
    for (const [id, p] of Object.entries(players)) {
      const pose = p.pose ?? null;
      const held = p.held ?? null;
      const prev = this.memory.get(id);
      const speed = Math.hypot(p.vel.x, p.vel.z);
      const mem: Memory = prev ?? { pose, held, nextStrokeAt: 0, riding: false };
      if (prev) {
        if (prev.held !== held) cues.push(shot(held ? 'wand-pickup' : 'wand-putback', p.pos));
        if (prev.pose !== pose) {
          if (isRide(pose) || isRide(prev.pose)) cues.push(shot('mount', p.pos));
          if (pose === 'swim') cues.push(shot('splash', p.pos));
          if (prev.pose === 'swim') cues.push(shot('splash', p.pos, 0.6));
        }
      }
      if (pose === 'swim' && speed > STROKE_MIN_SPEED && now >= mem.nextStrokeAt) {
        cues.push(shot('swim-stroke', p.pos, Math.min(1, 0.4 + speed / 6)));
        mem.nextStrokeAt = now + STROKE_GAP_MS;
      }
      const riding = isRide(pose) && speed > RIDE_MIN_SPEED;
      if (riding || mem.riding) {
        cues.push({ type: 'loop', key: `wheel:${id}`, sound: 'wheel', at: p.pos, level: riding ? Math.min(1, speed / RIDE_FULL_SPEED) : 0 });
      }
      mem.riding = riding;
      mem.pose = pose;
      mem.held = held;
      this.memory.set(id, mem);
    }
    for (const id of [...this.memory.keys()]) {
      if (!players[id]) {
        if (this.memory.get(id)?.riding) cues.push({ type: 'loop', key: `wheel:${id}`, sound: 'wheel', at: null, level: 0 });
        this.memory.delete(id);
      }
    }
    return cues;
  }
}
