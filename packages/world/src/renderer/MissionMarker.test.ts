import { describe, expect, it } from 'vitest';
import { markerText } from './MissionMarker.tsx';

describe('markerText', () => {
  it('appends the whole metres to the label', () => {
    expect(markerText('Mission: Stand-up', 14.8)).toBe('Mission: Stand-up · 14 m');
  });

  it('shows under a metre as <1', () => {
    expect(markerText('Mission: Stand-up', 0.4)).toBe('Mission: Stand-up · <1 m');
  });

  it('shows just the label before your position is known', () => {
    expect(markerText('Mission: Stand-up', null)).toBe('Mission: Stand-up');
  });
});
