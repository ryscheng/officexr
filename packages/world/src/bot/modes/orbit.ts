import type { BotModeContext, BotModeStrategy } from './types.ts';

export const orbitStrategy: BotModeStrategy = {
  onEnter(ctx: BotModeContext) {
    // Seed orbit angle from the current bot→local heading so we don't
    // teleport along the orbit circle on mode entry.
    ctx.modeState.orbitAngle = Math.atan2(
      ctx.botPos.z - ctx.localPlayerPos.z,
      ctx.botPos.x - ctx.localPlayerPos.x,
    );
  },
  /** Walk along the tangent of a circle around the local player. The
   * circle's radius is the current bot↔local distance, so the bot
   * doesn't snap to a fixed orbit radius — it just keeps that distance
   * and circles. */
  computeIntent(ctx: BotModeContext): { x: number; z: number } {
    const dx = ctx.botPos.x - ctx.localPlayerPos.x;
    const dz = ctx.botPos.z - ctx.localPlayerPos.z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-3) {
      // On top of the player — kick out in +X.
      return { x: 1, z: 0 };
    }
    // Tangent direction (90° CCW from the radius vector, normalised).
    return { x: -dz / r, z: dx / r };
  },
};
