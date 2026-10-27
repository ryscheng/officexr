import { describe, it, expect } from 'vitest';
import { voiceZoneAt } from '../../spatial/voice-zone.ts';
import type { VoiceZone } from '../../game-state/types.ts';

const zone = (id: string, x0: number, z0: number, x1: number, z1: number): VoiceZone => ({
  id,
  label: id,
  min: { x: x0, z: z0 },
  max: { x: x1, z: z1 },
});

describe('voiceZoneAt', () => {
  it('returns null outside every zone and for no zones', () => {
    expect(voiceZoneAt([], { x: 0, z: 0 })).toBeNull();
    expect(voiceZoneAt([zone('a', 0, 0, 2, 2)], { x: 3, z: 1 })).toBeNull();
  });

  it('treats bounds as inclusive', () => {
    const a = zone('a', 0, 0, 2, 2);
    for (const pos of [{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 1, z: 2 }]) {
      expect(voiceZoneAt([a], pos)).toBe(a);
    }
  });

  it('prefers the smallest overlapping zone regardless of order', () => {
    const big = zone('a', 0, 0, 10, 10);
    const small = zone('z', 4, 4, 6, 6);
    expect(voiceZoneAt([big, small], { x: 5, z: 5 })).toBe(small);
    expect(voiceZoneAt([small, big], { x: 5, z: 5 })).toBe(small);
  });

  it('breaks equal-area ties by lowest id', () => {
    const b = zone('b', 0, 0, 4, 4);
    const a = zone('a', 2, 2, 6, 6);
    expect(voiceZoneAt([b, a], { x: 3, z: 3 })).toBe(a);
    expect(voiceZoneAt([a, b], { x: 3, z: 3 })).toBe(a);
  });
});
