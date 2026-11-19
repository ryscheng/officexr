import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { excludeRacks, occupiedRacks } from './occupiedRacks.ts';

const rack = (id: string) => ({ id }) as ObjectInstance;

describe('occupiedRacks', () => {
  it('lists the racks players ride from, sorted, and nothing for walkers', () => {
    expect(occupiedRacks({ a: { poseRack: 'r2' }, b: {}, c: { poseRack: 'r1' }, d: { poseRack: null } })).toBe('r1|r2');
    expect(occupiedRacks({ a: {} })).toBe('');
  });
});

describe('excludeRacks', () => {
  it('leaves the base filter alone when no rack is ridden', () => {
    const base = () => false;
    expect(excludeRacks('', base)).toBe(base);
    expect(excludeRacks('', undefined)).toBeUndefined();
  });

  it('drops ridden racks from drawing and from colliders, and still applies the base filter', () => {
    const exclude = excludeRacks('r1|r2', (i) => i.id === 'baked')!;
    expect(exclude(rack('r1'))).toBe(true);
    expect(exclude(rack('r2'))).toBe(true);
    expect(exclude(rack('r3'))).toBe(false);
    expect(exclude(rack('baked'))).toBe(true);
  });
});
