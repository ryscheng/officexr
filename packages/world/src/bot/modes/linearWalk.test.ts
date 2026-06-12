/**
 * Unit tests for the linearWalk bot mode strategy.
 *
 * These tests exercise the strategy in isolation — no Rapier, no BotDriver.
 * The strategy is a pure intent source: computeIntent() returns a unit XZ
 * direction derived from modeState.linearWalkDir. Nothing else.
 */
import { describe, it, expect } from 'vitest';
import { linearWalkStrategy } from './linearWalk.ts';
import type { BotModeContext, ModeState } from './types.ts';

/** Build a minimal BotModeContext with the given linearWalkDir already set. */
function makeCtx(linearWalkDir: { x: number; z: number }): BotModeContext {
  const modeState: ModeState = {
    wanderDir: { x: 1, z: 0 },
    wanderUntilMs: 0,
    patrolIdx: 0,
    patrolWaypoints: null,
    orbitAngle: 0,
    linearWalkDir,
  };
  return {
    botPos: { x: 0, y: 0, z: 0 },
    localPlayerPos: { x: 0, y: 0, z: 0 },
    state: {} as never,
    clock: { now: () => 0 },
    modeState,
  };
}

/** Build a context whose modeState does NOT have linearWalkDir set (simulates
 * a modeState created before the field existed). */
function makeCtxNoDir(): BotModeContext {
  // Cast: deliberately omit linearWalkDir to test the onEnter-default path.
  const modeState = {
    wanderDir: { x: 1, z: 0 },
    wanderUntilMs: 0,
    patrolIdx: 0,
    patrolWaypoints: null,
    orbitAngle: 0,
  } as ModeState;
  return {
    botPos: { x: 0, y: 0, z: 0 },
    localPlayerPos: { x: 0, y: 0, z: 0 },
    state: {} as never,
    clock: { now: () => 0 },
    modeState,
  };
}

describe('linearWalkStrategy', () => {
  it('direction {x:0, z:1}: computeIntent returns {x:0, z:1} exactly', () => {
    const ctx = makeCtx({ x: 0, z: 1 });
    const result = linearWalkStrategy.computeIntent(ctx);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0, 10);
    expect(result!.z).toBeCloseTo(1, 10);
  });

  it('direction normalization: linearWalkDir={x:2, z:0} returns {x:1, z:0}', () => {
    const ctx = makeCtx({ x: 2, z: 0 });
    const result = linearWalkStrategy.computeIntent(ctx);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(1, 10);
    expect(result!.z).toBeCloseTo(0, 10);
  });

  it('zero vector fallback: linearWalkDir={x:0, z:0} returns {x:0, z:1}', () => {
    const ctx = makeCtx({ x: 0, z: 0 });
    const result = linearWalkStrategy.computeIntent(ctx);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0, 10);
    expect(result!.z).toBeCloseTo(1, 10);
  });

  it('onEnter sets default linearWalkDir when none is present on modeState', () => {
    const ctx = makeCtxNoDir();
    // Before onEnter: no linearWalkDir
    expect((ctx.modeState as unknown as Record<string, unknown>).linearWalkDir).toBeUndefined();
    linearWalkStrategy.onEnter!(ctx);
    expect(ctx.modeState.linearWalkDir).toEqual({ x: 0, z: 1 });
  });

  it('intent is always unit length for any valid non-zero direction input', () => {
    const cases: Array<{ x: number; z: number }> = [
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: -1, z: 0 },
      { x: 0, z: -1 },
      { x: 3, z: 4 },   // len=5, normalizes to {0.6, 0.8}
      { x: -2, z: 7 },
    ];
    for (const dir of cases) {
      const ctx = makeCtx(dir);
      const result = linearWalkStrategy.computeIntent(ctx);
      expect(result).not.toBeNull();
      const len = Math.hypot(result!.x, result!.z);
      expect(len).toBeCloseTo(1.0, 6);
    }
  });
});
