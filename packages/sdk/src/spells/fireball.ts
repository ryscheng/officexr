import { clamp01, fadeOut, NO_VISUAL, type SpellStrategy } from './types.ts';

const DURATION_MS = 3000;
const HOP_MS = 450;
const HOP_HEIGHT_M = 0.35;

export const fireball: SpellStrategy = {
  label: 'Fireball',
  durationMs: DURATION_MS,
  projectile: { speedMps: 8, color: '#ffb02e', trail: 'flame' },
  impact: 'fire',
  visual(ageMs) {
    const hop = ageMs < HOP_MS ? Math.sin(clamp01(ageMs / HOP_MS) * Math.PI) * HOP_HEIGHT_M : 0;
    return {
      ...NO_VISUAL,
      lift: hop,
      tint: '#1c1410',
      tintStrength: fadeOut(ageMs, DURATION_MS, 900) * 0.85,
      soot: fadeOut(ageMs, DURATION_MS, 900),
      smoke: true,
    };
  },
};
