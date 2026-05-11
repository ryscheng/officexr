import type { BotModeContext, BotModeStrategy, ModeState } from './types.ts';

/** Pick a fresh random wander direction and a hold window. `bias`
 * rotates away from the current direction so a re-pick after a wall
 * hit doesn't pick the same direction. */
export function pickWanderDirection(
  modeState: ModeState,
  nowMs: number,
  bias: number,
): void {
  const angle = Math.random() * Math.PI * 2 + bias;
  modeState.wanderDir = { x: Math.cos(angle), z: Math.sin(angle) };
  // 1.0–3.0 s hold window before the next direction change.
  modeState.wanderUntilMs = nowMs + 1000 + Math.random() * 2000;
}

export const wanderStrategy: BotModeStrategy = {
  onEnter(ctx: BotModeContext) {
    pickWanderDirection(ctx.modeState, ctx.clock.now(), 0);
  },
  computeIntent(ctx: BotModeContext) {
    if (ctx.clock.now() >= ctx.modeState.wanderUntilMs) {
      pickWanderDirection(ctx.modeState, ctx.clock.now(), 0);
    }
    return ctx.modeState.wanderDir;
  },
};
