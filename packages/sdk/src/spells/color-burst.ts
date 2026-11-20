import { fadeOut, NO_VISUAL, type SpellStrategy } from './types.ts';

const DURATION_MS = 5000;

export const colorBurst: SpellStrategy = {
  label: 'Color burst',
  durationMs: DURATION_MS,
  projectile: { speedMps: 14, color: '#ff6fd8', trail: 'sparkle' },
  impact: 'sparkle',
  visual(ageMs) {
    const hue = Math.round((ageMs / 6) % 360);
    return { ...NO_VISUAL, tint: `hsl(${hue}, 90%, 60%)`, tintStrength: 0.6 * fadeOut(ageMs, DURATION_MS, 500), sparkles: true };
  },
};
