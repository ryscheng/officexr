import { describe, expect, it } from 'vitest';
import { POKE_SPARK_DELAY_S, POKE_SPARK_LIFE_S, sparkProgress } from './PokeSpark.tsx';

describe('sparkProgress', () => {
  it('waits for the arm to arrive, then runs once from 0 to 1', () => {
    expect(sparkProgress(0)).toBe(0);
    expect(sparkProgress(POKE_SPARK_DELAY_S)).toBe(0);
    expect(sparkProgress(POKE_SPARK_DELAY_S + POKE_SPARK_LIFE_S / 2)).toBeCloseTo(0.5);
    expect(sparkProgress(10)).toBe(1);
  });
});
