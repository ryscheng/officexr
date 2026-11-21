// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_CHARACTER_HEIGHT_M,
  OVERHEAD_GAP_M,
  characterHeightOf,
  overheadAnchorY,
  recordCharacterHeight,
  useCharacterHeight,
} from './characterHeight.ts';

afterEach(cleanup);

describe('character height cache', () => {
  it('falls back until a model is measured, then answers per model', () => {
    expect(characterHeightOf('/h/unmeasured.glb')).toBe(FALLBACK_CHARACTER_HEIGHT_M);
    recordCharacterHeight('/h/tall.glb', 2.65);
    recordCharacterHeight('/h/short.glb', 1.2);
    expect(characterHeightOf('/h/tall.glb')).toBe(2.65);
    expect(characterHeightOf('/h/short.glb')).toBe(1.2);
  });

  it('ignores a failed measurement', () => {
    recordCharacterHeight('/h/bad.glb', 0);
    recordCharacterHeight('/h/bad.glb', Number.NaN);
    expect(characterHeightOf('/h/bad.glb')).toBe(FALLBACK_CHARACTER_HEIGHT_M);
  });

  it('updates a mounted reader when the model gets measured', () => {
    const { result } = renderHook(() => useCharacterHeight('/h/late.glb'));
    expect(result.current).toBe(FALLBACK_CHARACTER_HEIGHT_M);
    act(() => recordCharacterHeight('/h/late.glb', 1.9));
    expect(result.current).toBe(1.9);
  });

  it('anchors the stack a fixed gap above the head of each model', () => {
    expect(overheadAnchorY(2.65)).toBeCloseTo(2.65 + OVERHEAD_GAP_M);
    expect(overheadAnchorY(1.2)).toBeCloseTo(1.2 + OVERHEAD_GAP_M);
  });
});
