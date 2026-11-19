import { clamp01, NO_VISUAL, type SpellStrategy } from './types.ts';

const DURATION_MS = 5000;
const EASE_MS = 400;
const SCALE = 0.5;

export const shrink: SpellStrategy = {
  label: 'Shrink',
  durationMs: DURATION_MS,
  projectile: { speedMps: 14, color: '#b58cff', trail: 'sparkle' },
  impact: 'sparkle',
  visual(ageMs) {
    const k = Math.min(clamp01(ageMs / EASE_MS), clamp01((DURATION_MS - ageMs) / EASE_MS));
    return { ...NO_VISUAL, scale: 1 - (1 - SCALE) * k };
  },
};
