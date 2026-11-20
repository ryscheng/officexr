export interface SpellVisual {
  lift: number;
  scale: number;
  tint: string | null;
  tintStrength: number;
  soot: number;
  smoke: boolean;
  sparkles: boolean;
  moveSpeedScale: number;
}

export const NO_VISUAL: SpellVisual = {
  lift: 0,
  scale: 1,
  tint: null,
  tintStrength: 0,
  soot: 0,
  smoke: false,
  sparkles: false,
  moveSpeedScale: 1,
};

export interface SpellStrategy {
  label: string;
  durationMs: number;
  projectile: { speedMps: number; color: string; trail: 'flame' | 'sparkle' };
  impact: 'fire' | 'sparkle';
  visual(ageMs: number): SpellVisual;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const fadeOut = (ageMs: number, durationMs: number, fadeMs: number) =>
  clamp01((durationMs - ageMs) / fadeMs);
