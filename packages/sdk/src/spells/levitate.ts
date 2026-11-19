import { clamp01, NO_VISUAL, type SpellStrategy } from './types.ts';

const DURATION_MS = 5000;
const RISE_MS = 600;
const HEIGHT_M = 1;

export const levitate: SpellStrategy = {
  label: 'Levitate',
  durationMs: DURATION_MS,
  projectile: { speedMps: 14, color: '#8ee6ff', trail: 'sparkle' },
  impact: 'sparkle',
  visual(ageMs) {
    const rise = Math.min(clamp01(ageMs / RISE_MS), clamp01((DURATION_MS - ageMs) / RISE_MS));
    return { ...NO_VISUAL, lift: HEIGHT_M * rise + Math.sin(ageMs / 280) * 0.08 * rise, moveSpeedScale: 0 };
  },
};
